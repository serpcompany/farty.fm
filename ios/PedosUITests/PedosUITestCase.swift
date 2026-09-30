import XCTest

/// Launches the Debug app with sample data (see `SampleLaunchOptions`) and attaches screenshots.
///
/// Each test class has a dark-mode subclass that runs the same tests with the simulator in dark
/// mode, so every screenshot exists in both appearances. CI skips the dark-mode runs (they're
/// for screenshots) by setting `TEST_RUNNER_PEDOS_UI_TESTS_LIGHT_ONLY=1`.
@MainActor
class PedosUITestCase: XCTestCase {
    class var appearance: XCUIDevice.Appearance { .light }

    private var originalAppearance: XCUIDevice.Appearance?

    override func setUp() async throws {
        if Self.appearance == .dark, ProcessInfo.processInfo.environment["PEDOS_UI_TESTS_LIGHT_ONLY"] == "1" {
            throw XCTSkip("Dark-mode runs are for screenshots; run them locally.")
        }
        continueAfterFailure = false
        originalAppearance = XCUIDevice.shared.appearance
        XCUIDevice.shared.appearance = Self.appearance
    }

    override func tearDown() async throws {
        if let originalAppearance {
            XCUIDevice.shared.appearance = originalAppearance
        }
    }

    /// Launches Pedos.
    /// - Parameters:
    ///   - start: `new`, `few`, `all`, or how many story takes are already saved.
    ///   - microphone: a simulated permission (`granted`, `denied`, `undetermined`), or nil for
    ///     the real one.
    ///   - failures: failures to simulate once each.
    @discardableResult
    func launch(
        start: String = "new",
        microphone: String? = "granted",
        failures: [String] = [],
        welcomeSeen: Bool = true,
        analysisSeconds: Double = 1.5,
        app: XCUIApplication = XCUIApplication()
    ) -> XCUIApplication {
        app.launchArguments = [
            "-PedosSampleStart", start,
            "-welcomeSeen", welcomeSeen ? "YES" : "NO",
            "-PedosAnalysisSeconds", String(analysisSeconds),
        ]
        if let microphone {
            app.launchArguments += ["-PedosMicrophone", microphone]
        }
        if !failures.isEmpty {
            app.launchArguments += ["-PedosSampleFailure", failures.joined(separator: ",")]
        }
        app.launch()
        return app
    }

    /// Records a take of about a second and stops, which opens Review.
    func recordTake(in app: XCUIApplication, screenshot: String? = nil) {
        app.buttons["record-button"].tap()
        XCTAssertTrue(app.buttons["Stop"].waitForExistence(timeout: 5), "Recording didn't start")
        waitForTimerToCount(in: app)
        if let screenshot { attachScreenshot(screenshot) }
        app.buttons["record-button"].tap()
    }

    /// Waits until the recording timer shows at least a second.
    func waitForTimerToCount(in app: XCUIApplication) {
        let timer = app.staticTexts["recording-timer"]
        XCTAssertTrue(timer.waitForExistence(timeout: 5), "No recording timer")
        let counted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != '0:00'"), object: timer)
        XCTAssertEqual(XCTWaiter().wait(for: [counted], timeout: 5), .completed, "The timer didn't count")
    }

    /// Saves the take under Review and waits for the Result.
    func saveTake(in app: XCUIApplication) {
        XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 5), "Review didn't open")
        app.buttons["Save"].tap()
    }

    /// Attaches a screenshot of the whole screen, system alerts included.
    func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(name) (\(Self.appearance == .dark ? "dark" : "light"))"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
