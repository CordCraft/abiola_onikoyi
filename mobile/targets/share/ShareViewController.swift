import SwiftUI
import UIKit
import UniformTypeIdentifiers

// "Jarvis" in the share sheet. Take a screenshot of a song (YouTube Music,
// Spotify, Shazam, a TikTok sound, anything), tap the thumbnail, Share,
// Jarvis. Also takes a YouTube Music link (Share, Jarvis) or shared text.
// Sends it to /jarvis/api/songs; the server reads the song, saves it and
// pushes when the Suno version is ready.

final class ShareModel: ObservableObject {
  enum Phase: Equatable { case working, done(String), failed(String) }
  @Published var phase: Phase = .working
}

class ShareViewController: UIViewController {
  private let model = ShareModel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    let host = UIHostingController(rootView: ShareCard(model: model, close: { [weak self] in self?.close() }))
    host.view.backgroundColor = .clear
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
    Task { await send() }
  }

  private func close() {
    extensionContext?.completeRequest(returningItems: nil)
  }

  @MainActor private func set(_ phase: ShareModel.Phase) {
    model.phase = phase
  }

  private func send() async {
    do {
      guard let body = await payload() else {
        await set(.failed("Share a screenshot or a YouTube Music link."))
        return
      }
      let speech = try await JarvisAPI.likeSong(body)
      await set(.done(speech))
      try? await Task.sleep(nanoseconds: 2_200_000_000)
      await MainActor.run { close() }
    } catch let e as JarvisError {
      switch e {
      case .notPaired: await set(.failed("Open the Jarvis app and pair it first."))
      case .server(let m): await set(.failed(m))
      }
    } catch {
      await set(.failed(error.localizedDescription))
    }
  }

  // First image wins, then a link, then plain text.
  private func payload() async -> [String: Any]? {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    for p in providers where p.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      if let image = await loadImage(p), let jpeg = Self.shrink(image).jpegData(compressionQuality: 0.72) {
        return ["source": "screenshot", "image": jpeg.base64EncodedString(), "imageType": "image/jpeg"]
      }
    }
    for p in providers where p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      if let url = await load(p, UTType.url) as? URL { return ["source": "share", "url": url.absoluteString] }
    }
    for p in providers where p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      if let text = await load(p, UTType.plainText) as? String, !text.isEmpty { return ["source": "share", "text": text] }
    }
    return nil
  }

  private func load(_ p: NSItemProvider, _ type: UTType) async -> NSSecureCoding? {
    await withCheckedContinuation { cont in
      p.loadItem(forTypeIdentifier: type.identifier, options: nil) { item, _ in cont.resume(returning: item) }
    }
  }

  // The screenshot editor hands over a UIImage; Photos hands over a file URL
  // or raw data. Accept all three.
  private func loadImage(_ p: NSItemProvider) async -> UIImage? {
    let item = await load(p, UTType.image)
    if let image = item as? UIImage { return image }
    if let url = item as? URL, let data = try? Data(contentsOf: url) { return UIImage(data: data) }
    if let data = item as? Data { return UIImage(data: data) }
    return nil
  }

  // Long side 1600 px keeps small text readable and the upload under ~400 KB.
  static func shrink(_ image: UIImage) -> UIImage {
    let maxSide: CGFloat = 1600
    let size = image.size
    let scale = min(1, maxSide / max(size.width, size.height))
    if scale >= 1 { return image }
    let target = CGSize(width: size.width * scale, height: size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: target, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: target))
    }
  }
}

struct ShareCard: View {
  @ObservedObject var model: ShareModel
  let close: () -> Void

  var body: some View {
    VStack {
      Spacer()
      VStack(spacing: 14) {
        switch model.phase {
        case .working:
          ProgressView().controlSize(.large)
          Text("Finding the song…").font(.headline)
        case .done(let speech):
          Image(systemName: "heart.fill").font(.system(size: 34)).foregroundStyle(.pink)
          Text(speech).font(.headline).multilineTextAlignment(.center)
        case .failed(let message):
          Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 30)).foregroundStyle(.orange)
          Text(message).font(.subheadline).multilineTextAlignment(.center)
        }
        Button(model.phase == .working ? "Cancel" : "Done", action: close)
          .buttonStyle(.bordered)
          .padding(.top, 4)
      }
      .padding(24)
      .frame(maxWidth: .infinity)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
      .padding(.horizontal, 20)
      .padding(.bottom, 40)
    }
    .background(Color.black.opacity(0.25).ignoresSafeArea())
  }
}
