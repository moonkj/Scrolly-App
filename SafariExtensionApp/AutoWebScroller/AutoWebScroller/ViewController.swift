//
//  ViewController.swift
//  AutoWebScroller
//
//  Created by KJMoon on 2026. 2. 25..
//

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.configuration.userContentController.add(self, name: "openURL")
        self.webView.navigationDelegate = self
        self.webView.scrollView.isScrollEnabled = true

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "openURL", let urlString = message.body as? String, let url = URL(string: urlString) {
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Override point for customization.
    }

}
