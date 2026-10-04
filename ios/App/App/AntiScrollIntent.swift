import AppIntents
import Capacitor
import Foundation
import UIKit
import UserNotifications

// Анти-скролл: собственное действие Oyan для автоматизации «Команд».
//
// Пользователь добавляет в автоматизацию «Когда открывается приложение
// «Instagram»» действие «Анти-скролл: Instagram». Оно стартует в фоне и решает:
//   • пропуск активен («Всё равно открыть», «Не прерывать 1 час») → ничего;
//   • уведомления разрешены → баннер сверху, человек остаётся в Instagram,
//     тап по баннеру открывает Oyan сразу на предложенном деле: таймере
//     привычки, задачах или рефлексии;
//   • уведомления запрещены → выводит Oyan вперёд на экран перехвата.
//
// Выход вперёд — supportedModes с .foreground(.dynamic) и continueInForeground
// из iOS 26. Вариант с result(opensIntent:) iOS в фоновой автоматизации молча
// пропускала. На iOS старше 26 остаётся способ со ссылкой.
//
// Все ключи — в UserDefaults.standard с префиксом «CapacitorStorage.»: так их
// пишет и читает @capacitor/preferences в веб-части.

private let storagePrefix = "CapacitorStorage."

/// Момент, до которого перехват отключён, в миллисекундах от эпохи.
enum AntiScrollPass {
    static let key = storagePrefix + "oyan-wake-pass-until"

    static var isActive: Bool {
        guard
            let raw = UserDefaults.standard.string(forKey: key),
            let until = Double(raw)
        else { return false }
        return until > Date().timeIntervalSince1970 * 1000
    }
}

/// След последнего срабатывания: «время|приложение|решение». Экран настройки
/// показывает его, чтобы было видно, запускает ли iPhone действие вообще.
enum AntiScrollDiagnostics {
    static let key = storagePrefix + "oyan-intent-last-run"

    static func record(app: String, decision: String) {
        let ms = Int64(Date().timeIntervalSince1970 * 1000)
        UserDefaults.standard.set("\(ms)|\(app)|\(decision)", forKey: key)
    }
}

/// Снимок данных, из которых выбирается предложение. Привычки, задачи и
/// рефлексии живут в веб-части, поэтому она заранее складывает сюда всё нужное
/// с готовыми текстами на языке приложения (buildWakeSnapshot в useAntiScroll.js).
struct AntiScrollSnapshot: Decodable {
    struct Habit: Decodable {
        let id: String
        let bodies: [String]
    }

    struct Task: Decodable {
        let id: String
        /// День, на который задача запланирована (местный, yyyy-MM-dd).
        let date: String
        let body: String
    }

    /// День, к которому относятся done и skipped (UTC, как отметки привычек).
    let day: String
    /// «Ты открыл {app}» — {app} подставляется здесь.
    let title: String
    /// Только привычки, которые можно сделать где угодно.
    let habits: [Habit]
    let done: [String]
    let skipped: [String]
    /// Невыполненные задачи, включая запланированные наперёд.
    let tasks: [Task]
    /// День последней рефлексии (UTC) или nil, если их ещё не было.
    let reflectionDay: String?
    let reflectionBody: String
    let pickTaskBody: String

    static let key = storagePrefix + "oyan-wake-suggestion"

    /// nil — снимка нет или он в старом формате (приложение после обновления
    /// ещё не открывали).
    static func load() -> AntiScrollSnapshot? {
        guard let raw = UserDefaults.standard.string(forKey: key) else { return nil }
        return try? JSONDecoder().decode(AntiScrollSnapshot.self, from: Data(raw.utf8))
    }
}

/// Что предлагаем в этот раз.
struct AntiScrollOffer {
    /// «habit:<id>», «task:<id>», «reflection» или «pick-task» — по нему
    /// проверяется, не предлагали ли то же самое в прошлый раз.
    let id: String
    /// habit | task | reflection — уходит в ссылку баннера и в статистику.
    let type: String
    /// Id привычки: по нему приложение откроет таймер именно её.
    let habitId: String?
    let bodies: [String]
}

/// Выбор предложения. Повторяет pickSuggestion из src/lib/antiscroll.js —
/// меняешь здесь, меняй и там:
///   1. привычка «где угодно», не выполненная сегодня;
///   2. если таких нет — задача или (вечером) рефлексия, случайно из применимых;
///   3. если и этого нет — выбрать задачу, с которой начать.
/// Одно и то же два перехвата подряд не предлагаем.
enum AntiScrollPicker {
    /// Общий ключ с веб-частью: экран перехвата читает и пишет его же.
    static let lastKey = storagePrefix + "oyan-antiscroll-last-suggestion"
    static let reflectionFromHour = 18

    static var lastId: String {
        get { UserDefaults.standard.string(forKey: lastKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: lastKey) }
    }

    static func pick(from snapshot: AntiScrollSnapshot?, now: Date = Date()) -> AntiScrollOffer {
        guard let snap = snapshot else {
            return AntiScrollOffer(
                id: "pick-task", type: "task", habitId: nil,
                bodies: ["Выбери одну задачу, с которой начнёшь"]
            )
        }
        let last = lastId
        let habits = habitOffers(snap, now: now)
        // Единственную подходящую привычку чередуем с запасным действием.
        let onlyHabitWasLast = habits.count == 1 && habits[0].id == last
        let pool = (!habits.isEmpty && !onlyHabitWasLast)
            ? habits
            : fallbackOffers(snap, now: now, last: last)
        // pool не бывает пустым: fallbackOffers всегда возвращает хотя бы одно.
        return withoutLast(pool, last).randomElement()!
    }

    /// Без того, что предлагали в прошлый раз, — если после этого что-то остаётся.
    private static func withoutLast(_ list: [AntiScrollOffer], _ last: String) -> [AntiScrollOffer] {
        let rest = list.filter { $0.id != last }
        return rest.isEmpty ? list : rest
    }

    private static func habitOffers(_ snap: AntiScrollSnapshot, now: Date) -> [AntiScrollOffer] {
        // Отметки относятся к дню snap.day. Если он уже не сегодня, Oyan
        // сегодня не открывали — значит, ни одна привычка ещё не выполнена.
        let fresh = snap.day == day(now, utc: true)
        let done = Set(fresh ? snap.done : [])
        let skipped = Set(fresh ? snap.skipped : [])
        let pending = snap.habits.filter { !done.contains($0.id) && !$0.bodies.isEmpty }
        // Сначала не пропущенные сегодня; пропущенные — только если других нет.
        let startable = pending.filter { !skipped.contains($0.id) }
        return (startable.isEmpty ? pending : startable).map {
            AntiScrollOffer(id: "habit:\($0.id)", type: "habit", habitId: $0.id, bodies: $0.bodies)
        }
    }

    private static func fallbackOffers(_ snap: AntiScrollSnapshot, now: Date, last: String) -> [AntiScrollOffer] {
        var offers: [AntiScrollOffer] = []
        // Задачи на сегодня и висящие с прошлых дней; запланированные наперёд — нет.
        let today = day(now, utc: false)
        let due = snap.tasks.filter { $0.date <= today }.map {
            AntiScrollOffer(id: "task:\($0.id)", type: "task", habitId: nil, bodies: [$0.body])
        }
        if let task = withoutLast(due, last).randomElement() {
            offers.append(task)
        }
        let hour = Calendar.current.component(.hour, from: now)
        if snap.reflectionDay != day(now, utc: true) && hour >= reflectionFromHour {
            offers.append(AntiScrollOffer(
                id: "reflection", type: "reflection", habitId: nil, bodies: [snap.reflectionBody]
            ))
        }
        if offers.isEmpty {
            offers.append(AntiScrollOffer(
                id: "pick-task", type: "task", habitId: nil, bodies: [snap.pickTaskBody]
            ))
        }
        return offers
    }

    /// yyyy-MM-dd: по UTC — как отметки привычек и рефлексии в приложении,
    /// по местному времени — как даты задач.
    static func day(_ date: Date, utc: Bool) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc ? TimeZone(identifier: "UTC") : TimeZone.current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

enum AntiScrollNotification {
    /// Один идентификатор на все баннеры: новый заменяет старый, а не копится.
    static let identifier = "oyan-antiscroll"
    /// Не чаще одного баннера за это время — при переключениях туда-обратно
    /// между приложениями иначе они сыпались бы один за другим.
    static let cooldown: TimeInterval = 10 * 60
    static let lastKey = storagePrefix + "oyan-antiscroll-last-notified"
    /// Журнал показов для статистики: веб-часть отправляет его в events.
    static let logKey = storagePrefix + "oyan-antiscroll-notified-log"

    static var inCooldown: Bool {
        let last = UserDefaults.standard.double(forKey: lastKey)
        return last > 0 && Date().timeIntervalSince1970 - last < cooldown
    }

    static func isAllowed() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    /// Показывает баннер. Возвращает false, если iOS его не приняла.
    @available(iOS 26.0, *)
    static func post(app: InterceptedApp, title: String?, offer: AntiScrollOffer) async -> Bool {
        let content = UNMutableNotificationContent()
        content.title = (title ?? "Ты открыл {app}")
            .replacingOccurrences(of: "{app}", with: app.label)
        content.body = offer.bodies.randomElement() ?? ""
        // Без звука: баннер и так на виду, а звук при каждом открытии ленты раздражал бы.
        content.sound = nil
        // cap_extra — формат плагина LocalNotifications: в JS это придёт как
        // notification.extra.wake при тапе по баннеру. kind и id говорят
        // приложению, что именно предлагалось: привычка, задача или рефлексия.
        var url = "oyan://wake?app=\(app.rawValue)&start=1&kind=\(offer.type)"
        if let habitId = offer.habitId { url += "&id=\(habitId)" }
        content.userInfo = ["cap_extra": ["wake": url]]

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            return false
        }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastKey)
        AntiScrollPicker.lastId = offer.id
        appendLog(app: app.rawValue, type: offer.type)
        return true
    }

    private static func appendLog(app: String, type: String) {
        let defaults = UserDefaults.standard
        var list: [[String: Any]] = []
        if let raw = defaults.string(forKey: logKey),
           let arr = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [[String: Any]] {
            list = arr
        }
        list.append(["at": Int64(Date().timeIntervalSince1970 * 1000), "app": app, "type": type])
        if list.count > 50 { list = Array(list.suffix(50)) }
        if let data = try? JSONSerialization.data(withJSONObject: list),
           let s = String(data: data, encoding: .utf8) {
            defaults.set(s, forKey: logKey)
        }
    }
}

@available(iOS 26.0, *)
enum InterceptedApp: String, AppEnum {
    case instagram, tiktok, youtube

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Приложение"
    static let caseDisplayRepresentations: [InterceptedApp: DisplayRepresentation] = [
        .instagram: "Instagram",
        .tiktok: "TikTok",
        .youtube: "YouTube",
    ]

    // Название для текста баннера. Товарные знаки — только текстом.
    var label: String {
        switch self {
        case .instagram: return "Instagram"
        case .tiktok: return "TikTok"
        case .youtube: return "YouTube"
        }
    }
}

@available(iOS 26.0, *)
struct AntiScrollIntent: AppIntent {
    static let title: LocalizedStringResource = "Анти-скролл"
    static let description = IntentDescription(
        "Предлагает короткое дело вместо ленты: привычку, задачу или рефлексию. Если перехват на время отключён, ничего не делает."
    )

    // Стартуем в фоне; на передний план выходим, только если нельзя показать баннер.
    static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

    @Parameter(title: "Приложение", default: .instagram)
    var app: InterceptedApp

    init() {}

    init(app: InterceptedApp) {
        self.app = app
    }

    func perform() async throws -> some IntentResult {
        if AntiScrollPass.isActive {
            AntiScrollDiagnostics.record(app: app.rawValue, decision: "pass")
            return .result()
        }

        if await AntiScrollNotification.isAllowed() {
            if AntiScrollNotification.inCooldown {
                AntiScrollDiagnostics.record(app: app.rawValue, decision: "cooldown")
                return .result()
            }
            let snapshot = AntiScrollSnapshot.load()
            let offer = AntiScrollPicker.pick(from: snapshot)
            if await AntiScrollNotification.post(app: app, title: snapshot?.title, offer: offer) {
                AntiScrollDiagnostics.record(app: app.rawValue, decision: "notified")
                return .result()
            }
            // iOS не приняла баннер — показываем экран перехвата, как без уведомлений.
        }

        do {
            // Без подтверждения: человек сам настроил эту автоматизацию.
            try await continueInForeground(alwaysConfirm: false)
        } catch {
            // Система не дала выйти вперёд или человек отказался — молча
            // завершаемся, чтобы автоматизация не показывала ошибку.
            AntiScrollDiagnostics.record(app: app.rawValue, decision: "declined")
            return .result()
        }

        AntiScrollDiagnostics.record(app: app.rawValue, decision: "open")
        let url = URL(string: "oyan://wake?app=\(app.rawValue)")!
        await MainActor.run {
            // Та же точка входа, что и у внешней ссылки: Capacitor передаст её
            // веб-части событием appUrlOpen, а на холодном старте — через
            // getLaunchUrl (он читает lastURL этого же прокси).
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        return .result()
    }
}

// Готовые действия, по одному на приложение: в списке на экране автоматизации
// они видны сразу с нужным приложением, выбирать параметр не приходится.
@available(iOS 26.0, *)
struct OyanShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AntiScrollIntent(app: .instagram),
            phrases: ["Анти-скролл Instagram в \(.applicationName)"],
            shortTitle: "Анти-скролл: Instagram",
            systemImageName: "hand.raised"
        )
        AppShortcut(
            intent: AntiScrollIntent(app: .tiktok),
            phrases: ["Анти-скролл TikTok в \(.applicationName)"],
            shortTitle: "Анти-скролл: TikTok",
            systemImageName: "hand.raised"
        )
        AppShortcut(
            intent: AntiScrollIntent(app: .youtube),
            phrases: ["Анти-скролл YouTube в \(.applicationName)"],
            shortTitle: "Анти-скролл: YouTube",
            systemImageName: "hand.raised"
        )
    }
}
