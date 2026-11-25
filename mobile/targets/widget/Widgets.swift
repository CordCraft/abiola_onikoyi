import AppIntents
import SwiftUI
import WidgetKit

// Home screen (small, medium, large) and lock screen widgets showing what is
// left today, with tap-to-complete checkboxes, plus a Control Center / Action
// Button control that opens Jarvis listening.

@main
struct JarvisWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    if #available(iOS 18.0, *) {
      TalkControl()
      LikeSongControl()
    }
  }
}

// ── Timeline ─────────────────────────────────────────────────────────────────

struct TodayEntry: TimelineEntry {
  let date: Date
  let today: TodayPayload?
  let paired: Bool
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: .now, today: .sample, paired: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    if context.isPreview {
      completion(TodayEntry(date: .now, today: .sample, paired: true))
      return
    }
    completion(TodayEntry(date: .now, today: JarvisAPI.cachedToday() ?? .sample, paired: true))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    Task {
      var entry: TodayEntry
      do {
        let fresh = try await JarvisAPI.today()
        entry = TodayEntry(date: .now, today: fresh, paired: true)
      } catch JarvisError.notPaired {
        entry = TodayEntry(date: .now, today: nil, paired: false)
      } catch {
        entry = TodayEntry(date: .now, today: JarvisAPI.cachedToday(), paired: true)
      }
      // Refresh every 20 minutes; the app and intents also reload on changes.
      let next = Calendar.current.date(byAdding: .minute, value: 20, to: .now) ?? .now.addingTimeInterval(1200)
      completion(Timeline(entries: [entry], policy: .after(next)))
    }
  }
}

// ── Widget ───────────────────────────────────────────────────────────────────

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: JarvisConfig.widgetKind, provider: TodayProvider()) { entry in
      TodayWidgetView(entry: entry)
        .containerBackground(Color("$widgetBackground"), for: .widget)
    }
    .configurationDisplayName("Jarvis today")
    .description("What is left today, in order. Tap a circle to tick it off.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge,
      .accessoryRectangular, .accessoryCircular, .accessoryInline,
    ])
  }
}

struct TodayWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: TodayEntry

  var body: some View {
    if !entry.paired {
      Text("Open Jarvis to pair")
        .font(.caption)
        .widgetURL(URL(string: "jarvisapp://pair"))
    } else if let today = entry.today {
      switch family {
      case .accessoryInline:
        Text(inlineText(today))
      case .accessoryCircular:
        CircularView(today: today)
      case .accessoryRectangular:
        RectangularView(today: today)
      case .systemSmall:
        SmallView(today: today)
      case .systemLarge:
        ListView(today: today, rows: 7)
      default:
        ListView(today: today, rows: 3)
      }
    } else {
      Text("Jarvis is offline")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  func inlineText(_ t: TodayPayload) -> String {
    t.mustDoCount == 0 ? "Jarvis: clear for today" : "Jarvis: \(t.mustDoCount) left today"
  }
}

// Lock screen: a ring with the count left today
struct CircularView: View {
  let today: TodayPayload
  var body: some View {
    let left = today.mustDoCount
    let done = today.counts.doneToday
    let total = max(left + done, 1)
    Gauge(value: Double(done), in: 0...Double(total)) {
      Image(systemName: "checklist")
    } currentValueLabel: {
      Text("\(left)")
    }
    .gaugeStyle(.accessoryCircularCapacity)
    .widgetURL(URL(string: "jarvisapp://"))
  }
}

// Lock screen: count plus the next thing to do
struct RectangularView: View {
  let today: TodayPayload
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(today.mustDoCount == 0 ? "Clear for today" : "\(today.mustDoCount) left today")
        .font(.headline)
        .widgetAccentable()
      ForEach(today.tasks.prefix(2)) { task in
        Text(task.title).font(.caption).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(URL(string: "jarvisapp://"))
  }
}

struct SmallView: View {
  let today: TodayPayload
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text("\(today.mustDoCount)")
          .font(.system(size: 40, weight: .bold, design: .rounded))
          .foregroundStyle(Color("navy"))
        Text("left today").font(.caption).foregroundStyle(.secondary)
      }
      ForEach(today.tasks.prefix(2)) { task in
        Text(task.title).font(.caption).lineLimit(1)
      }
      Spacer(minLength: 0)
      if today.counts.doneToday > 0 {
        Text("\(today.counts.doneToday) done").font(.caption2).foregroundStyle(Color("$accent"))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(URL(string: "jarvisapp://"))
  }
}

struct ListView: View {
  let today: TodayPayload
  let rows: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(today.mustDoCount == 0 ? "Clear for today" : "\(today.mustDoCount) left today")
          .font(.headline)
          .foregroundStyle(Color("navy"))
        Spacer()
        Link(destination: URL(string: "jarvisapp://talk")!) {
          Image(systemName: "waveform.circle.fill")
            .font(.title2)
            .foregroundStyle(Color("$accent"))
        }
      }
      if today.tasks.isEmpty {
        Text("Nothing open. Enjoy it.").font(.subheadline).foregroundStyle(.secondary)
      }
      ForEach(today.tasks.prefix(rows)) { task in
        HStack(spacing: 10) {
          Button(intent: ToggleDoneIntent(taskId: task.id)) {
            Image(systemName: "circle")
              .font(.body)
              .foregroundStyle(task.priority == "high" ? Color("danger") : Color.secondary)
          }
          .buttonStyle(.plain)
          VStack(alignment: .leading, spacing: 0) {
            Text(task.title).font(.subheadline).lineLimit(1)
            if task.bucket == "overdue" {
              Text("overdue").font(.caption2).foregroundStyle(Color("danger"))
            } else if task.status == "doing" {
              Text("in progress").font(.caption2).foregroundStyle(.secondary)
            }
          }
          Spacer(minLength: 0)
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(URL(string: "jarvisapp://"))
  }
}

// ── Control Center / Action Button / lock screen control ─────────────────────

@available(iOS 18.0, *)
struct TalkControl: ControlWidget {
  static let kind = "com.abiolaonikoyi.jarvis.talk"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: TalkToJarvisIntent()) {
        Label("Talk to Jarvis", systemImage: "waveform")
      }
    }
    .displayName("Talk to Jarvis")
    .description("Open Jarvis listening.")
  }
}

// Swipe down from the top right, tap the heart: the song playing on YouTube
// Music is saved and turned into your own Suno version. Runs in the
// background, so the music keeps playing and the app does not open.
@available(iOS 18.0, *)
struct LikeSongControl: ControlWidget {
  static let kind = "com.abiolaonikoyi.jarvis.likesong"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: LikeSongIntent(source: "control")) {
        Label("Like this song", systemImage: "heart.fill")
      }
    }
    .displayName("Like this song")
    .description("Save what YouTube Music is playing and write your Suno version.")
  }
}
