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
//     тап по баннеру открывает Oyan сразу на таймере;
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

/// Готовые тексты уведомления. Привычки живут в веб-части, поэтому она заранее
/// складывает сюда заголовок и варианты предложения на языке приложения.
struct AntiScrollSuggestion: Decodable {
    /// День, для которого собраны тексты (UTC, как и отметки привычек в приложении).
    let date: String
    /// «Ты открыл {app}» — {app} подставляется здесь.
    let title: String
    let bodies: [String]
    let allDone: Bool

    static let key = storagePrefix + "oyan-wake-suggestion"

    /// Тексты на сегодня. Вчерашние не годятся: привычка могла быть уже сделана
    /// или, наоборот, «все сделаны» относилось к прошлому дню.
    static func loadForToday() -> AntiScrollSuggestion? {
        guard
            let raw = UserDefaults.standard.string(forKey: key),
            let s = try? JSONDecoder().decode(AntiScrollSuggestion.self, from: Data(raw.utf8)),
            s.date == todayUTC()
        else { return nil }
        return s
    }

    static func todayUTC() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
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
    static func post(app: InterceptedApp, suggestion: AntiScrollSuggestion?) async -> Bool {
        let content = UNMutableNotificationContent()
        content.title = (suggestion?.title ?? "Ты открыл {app}")
            .replacingOccurrences(of: "{app}", with: app.label)
        content.body = suggestion?.bodies.randomElement() ?? "Может, сначала короткая привычка?"
        // Без звука: баннер и так на виду, а звук при каждом открытии ленты раздражал бы.
        content.sound = nil
        // cap_extra — формат плагина LocalNotifications: в JS это придёт как
        // notification.extra.wake при тапе по баннеру.
        content.userInfo = ["cap_extra": ["wake": "oyan://wake?app=\(app.rawValue)&start=1"]]

        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            return false
        }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastKey)
        appendLog(app: app.rawValue)
        return true
    }

    private static func appendLog(app: String) {
        let defaults = UserDefaults.standard
        var list: [[String: Any]] = []
        if let raw = defaults.string(forKey: logKey),
           let arr = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [[String: Any]] {
            list = arr
        }
        list.append(["at": Int64(Date().timeIntervalSince1970 * 1000), "app": app])
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
        "Предлагает короткую привычку вместо ленты. Если перехват на время отключён, ничего не делает."
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
            let suggestion = AntiScrollSuggestion.loadForToday()
            // Все привычки на сегодня сделаны — не давим, баннер не нужен.
            if suggestion?.allDone == true {
                AntiScrollDiagnostics.record(app: app.rawValue, decision: "done")
                return .result()
            }
            if await AntiScrollNotification.post(app: app, suggestion: suggestion) {
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
