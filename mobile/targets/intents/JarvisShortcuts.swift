import AppIntents

// The Siri phrases. Apple requires the app's name in every phrase, so these
// all say "Jarvis" (the app name). They register automatically when the app is
// installed: no Shortcuts setup needed.

@main
struct JarvisIntentsExtension: AppIntentsExtension {}

// The extension targets iOS 18 (OpenURLIntent for the "open Jarvis" phrases).
@available(iOS 18.0, *)
struct JarvisShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: WhatsLeftIntent(),
      phrases: [
        "What's left in \(.applicationName)",
        "What's left today in \(.applicationName)",
        "Ask \(.applicationName) what's left",
        "Ask \(.applicationName) what's left today",
        "Where are we with \(.applicationName)",
        "Check my \(.applicationName) list",
        "What do I still need to do in \(.applicationName)",
      ],
      shortTitle: "What's left today",
      systemImageName: "checklist"
    )
    AppShortcut(
      intent: TalkToJarvisIntent(),
      phrases: [
        "Talk to \(.applicationName)",
        "Open \(.applicationName) voice",
        "Start talking to \(.applicationName)",
      ],
      shortTitle: "Talk to Jarvis",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: CompleteTaskIntent(),
      phrases: [
        "Mark a task done in \(.applicationName)",
        "Tick off a task in \(.applicationName)",
        "I finished a task in \(.applicationName)",
      ],
      shortTitle: "Mark done",
      systemImageName: "checkmark.circle"
    )
    AppShortcut(
      intent: AddTaskIntent(),
      phrases: [
        "Add a task in \(.applicationName)",
        "Add to my \(.applicationName) list",
        "Remind me in \(.applicationName)",
      ],
      shortTitle: "Add a task",
      systemImageName: "plus.circle"
    )
    AppShortcut(
      intent: SnoozeTaskIntent(),
      phrases: [
        "Move a task to tomorrow in \(.applicationName)",
        "Push a task to tomorrow in \(.applicationName)",
      ],
      shortTitle: "Move to tomorrow",
      systemImageName: "arrow.uturn.forward.circle"
    )
    AppShortcut(
      intent: StartTaskIntent(),
      phrases: [
        "Start a task in \(.applicationName)",
        "I'm starting a task in \(.applicationName)",
      ],
      shortTitle: "Start a task",
      systemImageName: "play.circle"
    )
    AppShortcut(
      intent: AskJarvisIntent(),
      phrases: [
        "Ask \(.applicationName) a question",
        "I have a question for \(.applicationName)",
      ],
      shortTitle: "Ask Jarvis",
      systemImageName: "sparkles"
    )
    AppShortcut(
      intent: LikeSongIntent(source: "siri"),
      phrases: [
        "Like this song in \(.applicationName)",
        "Save this song to \(.applicationName)",
        "\(.applicationName) I like this song",
      ],
      shortTitle: "Like this song",
      systemImageName: "heart.fill"
    )
    AppShortcut(
      intent: DeskModeIntent(),
      phrases: [
        "Start desk mode in \(.applicationName)",
        "\(.applicationName) desk mode",
      ],
      shortTitle: "Desk mode",
      systemImageName: "desktopcomputer"
    )
  }
}
