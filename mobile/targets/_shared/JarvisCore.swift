import AppIntents
import Foundation
import WidgetKit

// Shared by the app, the widget and the Siri extension (targets/_shared is
// linked into every target). Talks to the Jarvis site with the device token the
// app mirrors into the App Group (src/lib/storage.ts).

enum JarvisConfig {
  static let appGroup = "group.com.abiolaonikoyi.jarvis"
  static let widgetKind = "JarvisToday"
}

struct TodayTask: Codable, Identifiable, Hashable {
  let id: String
  let title: String
  let priority: String
  let status: String
  let due: String?
  let bucket: String
  let project: String?

  var isMustDo: Bool { bucket == "overdue" || bucket == "today" }
}

struct TodayCounts: Codable, Hashable {
  let overdue: Int
  let today: Int
  let doing: Int
  let open: Int
  let doneToday: Int
  let signals: Int
}

struct TodayPayload: Codable, Hashable {
  let generatedAt: String
  let tz: String
  let date: String
  let counts: TodayCounts
  let tasks: [TodayTask]
  let speech: String

  var mustDoCount: Int { counts.overdue + counts.today }

  static let sample = TodayPayload(
    generatedAt: "",
    tz: "Asia/Kuwait",
    date: "",
    counts: TodayCounts(overdue: 1, today: 3, doing: 1, open: 9, doneToday: 2, signals: 1),
    tasks: [
      TodayTask(id: "1", title: "File the VAT return", priority: "high", status: "todo", due: nil, bucket: "overdue", project: "HopperTax"),
      TodayTask(id: "2", title: "Call the bank about the USD account", priority: "medium", status: "todo", due: nil, bucket: "today", project: "Nikstalis"),
      TodayTask(id: "3", title: "Review the rack quote", priority: "medium", status: "todo", due: nil, bucket: "today", project: nil),
      TodayTask(id: "4", title: "Gym", priority: "low", status: "todo", due: nil, bucket: "today", project: nil),
    ],
    speech: "You have 4 things left for today."
  )
}

enum JarvisError: Error, CustomLocalizedStringResourceConvertible {
  case notPaired
  case server(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notPaired: return "Open the Jarvis app and pair it first."
    case .server(let message): return "Jarvis could not do that: \(message)"
    }
  }
}

enum JarvisAPI {
  static var shared: UserDefaults? { UserDefaults(suiteName: JarvisConfig.appGroup) }

  private static func credentials() throws -> (host: String, token: String) {
    guard let d = shared, let token = d.string(forKey: "token"), let host = d.string(forKey: "host"),
          !token.isEmpty
    else { throw JarvisError.notPaired }
    return (host, token)
  }

  static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
    let creds = try credentials()
    guard let url = URL(string: creds.host + path) else { throw JarvisError.server("bad address") }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.timeoutInterval = 15
    req.setValue("Bearer \(creds.token)", forHTTPHeaderField: "Authorization")
    if let body {
      req.httpBody = try JSONSerialization.data(withJSONObject: body)
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response) = try await URLSession.shared.data(for: req)
    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
    if code == 401 { throw JarvisError.notPaired }
    if code >= 400 { throw JarvisError.server("error \(code)") }
    return data
  }

  // Fetches and caches the list the widget shows.
  @discardableResult
  static func today() async throws -> TodayPayload {
    let data = try await request("/jarvis/api/mobile/today?limit=12")
    let payload = try JSONDecoder().decode(TodayPayload.self, from: data)
    if let text = String(data: data, encoding: .utf8) { shared?.set(text, forKey: "today") }
    return payload
  }

  static func cachedToday() -> TodayPayload? {
    guard let text = shared?.string(forKey: "today"), let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(TodayPayload.self, from: data)
  }

  static func taskAction(_ id: String, _ action: String) async throws {
    _ = try await request("/jarvis/api/task-action", method: "POST", body: ["taskId": id, "action": action])
  }

  static func addTask(_ title: String, due: String?) async throws {
    var body: [String: Any] = ["title": title]
    if let due { body["due"] = due }
    _ = try await request("/jarvis/api/mobile/tasks", method: "POST", body: body)
  }

  struct FoundTask: Codable { let id: String; let title: String }
  struct FoundTasks: Codable { let tasks: [FoundTask] }

  static func searchTasks(_ query: String) async throws -> [FoundTask] {
    let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
    let data = try await request("/jarvis/api/mobile/tasks?q=\(q)")
    return try JSONDecoder().decode(FoundTasks.self, from: data).tasks
  }

  // After any change: refetch so the widget is current, then redraw it.
  static func refreshWidgets() async {
    _ = try? await today()
    WidgetCenter.shared.reloadAllTimelines()
  }
}

// ── Task entity: lets Siri resolve "the VAT return" to a real task ───────────

struct TaskEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Task"
  static let defaultQuery = TaskQuery()

  let id: String
  let title: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct TaskQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [TaskEntity] {
    let all = try await JarvisAPI.searchTasks("")
    return all.filter { identifiers.contains($0.id) }.map { TaskEntity(id: $0.id, title: $0.title) }
  }

  func entities(matching string: String) async throws -> [TaskEntity] {
    var found = try await JarvisAPI.searchTasks(string)
    if found.isEmpty {
      // Spoken titles rarely match exactly: try the longest word
      let word = string.split(separator: " ").map(String.init).max(by: { $0.count < $1.count }) ?? string
      found = try await JarvisAPI.searchTasks(word)
    }
    return found.map { TaskEntity(id: $0.id, title: $0.title) }
  }

  func suggestedEntities() async throws -> [TaskEntity] {
    let today = try await JarvisAPI.today()
    return today.tasks.prefix(10).map { TaskEntity(id: $0.id, title: $0.title) }
  }
}

// ── Intents ──────────────────────────────────────────────────────────────────

struct WhatsLeftIntent: AppIntent {
  static let title: LocalizedStringResource = "What's left today"
  static let description = IntentDescription("Hear what is still open on your Jarvis list today, in order.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let today = try await JarvisAPI.today()
    WidgetCenter.shared.reloadAllTimelines()
    return .result(dialog: IntentDialog(stringLiteral: today.speech))
  }
}

struct CompleteTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Mark a task done"
  static let description = IntentDescription("Tick a task off your Jarvis list.")

  @Parameter(title: "Task", requestValueDialog: "Which task is done?")
  var task: TaskEntity

  static var parameterSummary: some ParameterSummary { Summary("Mark \(\.$task) done") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await JarvisAPI.taskAction(task.id, "done")
    await JarvisAPI.refreshWidgets()
    return .result(dialog: "Done. \(task.title) is off your list.")
  }
}

struct SnoozeTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Move a task to tomorrow"
  static let description = IntentDescription("Push a Jarvis task to tomorrow.")

  @Parameter(title: "Task", requestValueDialog: "Which task should move to tomorrow?")
  var task: TaskEntity

  static var parameterSummary: some ParameterSummary { Summary("Move \(\.$task) to tomorrow") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await JarvisAPI.taskAction(task.id, "snooze")
    await JarvisAPI.refreshWidgets()
    return .result(dialog: "Moved \(task.title) to tomorrow.")
  }
}

struct StartTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Start a task"
  static let description = IntentDescription("Mark a Jarvis task as in progress.")

  @Parameter(title: "Task", requestValueDialog: "Which task are you starting?")
  var task: TaskEntity

  static var parameterSummary: some ParameterSummary { Summary("Start \(\.$task)") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await JarvisAPI.taskAction(task.id, "doing")
    await JarvisAPI.refreshWidgets()
    return .result(dialog: "Okay, \(task.title) is in progress.")
  }
}

struct AddTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Add a task"
  static let description = IntentDescription("Add a task to Jarvis for today.")

  @Parameter(title: "Task", requestValueDialog: "What should I add?")
  var title: String

  @Parameter(title: "For today", default: true)
  var forToday: Bool

  static var parameterSummary: some ParameterSummary { Summary("Add \(\.$title) to Jarvis") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await JarvisAPI.addTask(title, due: forToday ? "today" : nil)
    await JarvisAPI.refreshWidgets()
    return .result(dialog: "Added \(title).")
  }
}

// Opening the app: these run in the app process (openAppWhenRun), which is
// why this file is linked into the main app as well.
@available(iOS 18.0, *)
struct TalkToJarvisIntent: AppIntent {
  static let title: LocalizedStringResource = "Talk to Jarvis"
  static let description = IntentDescription("Open Jarvis listening, ready for a conversation.")
  static let openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "jarvisapp://talk")!))
  }
}

@available(iOS 18.0, *)
struct DeskModeIntent: AppIntent {
  static let title: LocalizedStringResource = "Start desk mode"
  static let description = IntentDescription("Jarvis keeps listening for \"Hey Jarvis\", even with the screen off.")
  static let openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "jarvisapp://talk?wake=1")!))
  }
}

@available(iOS 18.0, *)
struct AskJarvisIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask Jarvis"
  static let description = IntentDescription("Ask Jarvis anything and hear the answer.")
  static let openAppWhenRun = true

  @Parameter(title: "Question", requestValueDialog: "What do you want to ask?")
  var question: String

  @MainActor
  func perform() async throws -> some IntentResult & OpensIntent {
    var parts = URLComponents(string: "jarvisapp://talk")!
    parts.queryItems = [URLQueryItem(name: "ask", value: question)]
    return .result(opensIntent: OpenURLIntent(parts.url!))
  }
}

// Widget checkbox: ticks a task off right on the home or lock screen.
struct ToggleDoneIntent: AppIntent {
  static let title: LocalizedStringResource = "Complete task"
  static let isDiscoverable = false

  @Parameter(title: "Task ID")
  var taskId: String

  init() {}
  init(taskId: String) { self.taskId = taskId }

  func perform() async throws -> some IntentResult {
    try await JarvisAPI.taskAction(taskId, "done")
    await JarvisAPI.refreshWidgets()
    return .result()
  }
}
