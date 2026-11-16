import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// The web view's controller: registers the app's own plugin (the tip jar), turns off zoom, and
// matches the game's dark background so nothing flashes white while it loads.
class AppViewController: CAPBridgeViewController {
    private static let pageBackground = UIColor(red: 22 / 255, green: 26 / 255, blue: 32 / 255, alpha: 1) // #161A20

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OpenWorldPlugin())
        view.backgroundColor = AppViewController.pageBackground
        webView?.isOpaque = false
        webView?.backgroundColor = AppViewController.pageBackground
        webView?.scrollView.backgroundColor = AppViewController.pageBackground
        webView?.scrollView.minimumZoomScale = 1   // no pinch-zoom of the page (the map has its own)
        webView?.scrollView.maximumZoomScale = 1
        webView?.scrollView.bouncesZoom = false
        webView?.scrollView.isScrollEnabled = false
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
