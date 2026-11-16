// The app's own Capacitor plugin (lives in the App target, registered in SceneDelegate.swift).
// The tip jar: three consumable in-app purchases (StoreKit 2). Tips unlock nothing.
//
// JS (src/native/native.js): registerPlugin('OpenWorld'), never awaited directly.
//   tipProducts() -> { products: [{ id, name, price, value }], problem? }
//   tip({ id })   -> { ok } | { cancelled } | { pending } | { error, detail? }

import UIKit
import StoreKit
import Capacitor

@objc(OpenWorldPlugin)
public class OpenWorldPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpenWorldPlugin"
    public let jsName = "OpenWorld"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "tipProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tip", returnType: CAPPluginReturnPromise),
    ]

    // must match App Store Connect exactly (consumables)
    static let tipIDs = ["com.mediavanity.openworld.tip.small", "com.mediavanity.openworld.tip.medium", "com.mediavanity.openworld.tip.large"]
    private static var cached: [Product] = []
    private static var problem = ""
    private var updates: Task<Void, Never>?

    override public func load() {
        // tips completed outside the app's own flow (Ask to Buy approved later): just finish them
        updates = Task.detached {
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
            }
        }
    }

    // StoreKit can hang when products can't load (no network, products not set up, agreement
    // not Active), so the lookup gives up after `timeout` seconds.
    private static func lookup(timeout: Double = 15) async -> [Product] {
        if !cached.isEmpty { return cached }
        let found: [Product] = await withCheckedContinuation { cont in
            let once = Once()
            Task {
                do {
                    let p = try await Product.products(for: tipIDs)
                    once.run { problem = p.isEmpty ? "the App Store returned no products" : ""; cont.resume(returning: p) }
                } catch {
                    once.run { problem = "StoreKit: \(error.localizedDescription)"; cont.resume(returning: []) }
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                once.run { problem = "no answer from the App Store in \(Int(timeout)) seconds"; cont.resume(returning: []) }
            }
        }
        if !found.isEmpty { cached = found }
        return found
    }

    @objc func tipProducts(_ call: CAPPluginCall) {
        Task {
            let list = await OpenWorldPlugin.lookup()
            call.resolve([
                "products": list.map { ["id": $0.id, "name": $0.displayName, "price": $0.displayPrice, "value": NSDecimalNumber(decimal: $0.price).doubleValue] },
                "problem": OpenWorldPlugin.problem,
            ])
        }
    }

    @objc func tip(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        Task {
            guard let product = await OpenWorldPlugin.lookup().first(where: { $0.id == id }) else {
                call.resolve(["error": "unavailable", "detail": OpenWorldPlugin.problem])
                return
            }
            do {
                switch try await purchase(product) {
                case .success(let verification):
                    if case .verified(let t) = verification { await t.finish(); call.resolve(["ok": true]) }
                    else { call.resolve(["error": "unverified"]) }
                case .pending: call.resolve(["pending": true])
                case .userCancelled: call.resolve(["cancelled": true])
                @unknown default: call.resolve(["error": "unknown"])
                }
            } catch {
                call.resolve(["error": error.localizedDescription])
            }
        }
    }

    // A scene-based app must name the window scene for the purchase sheet (iOS 17+).
    private func purchase(_ product: Product) async throws -> Product.PurchaseResult {
        if #available(iOS 17.0, *) {
            let scene: UIScene? = await MainActor.run {
                self.bridge?.viewController?.view.window?.windowScene
                    ?? UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive }
            }
            if let scene = scene { return try await product.purchase(confirmIn: scene) }
        }
        return try await product.purchase()
    }
}

// Runs its closure the first time only (two tasks race to resume one continuation).
final class Once {
    private let lock = NSLock()
    private var done = false
    func run(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        if done { return }
        done = true
        body()
    }
}
