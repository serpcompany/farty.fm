import XCTest

/// First launch: Welcome, the system microphone prompt, and "Microphone off".
class FirstLaunchUITests: PedosUITestCase {
    /// Uses the real microphone permission: Welcome's button shows the system prompt.
    func testWelcomeAsksForTheMicrophoneOnFirstLaunch() {
        let app = XCUIApplication()
        app.resetAuthorizationStatus(for: .microphone)
        launch(microphone: nil, welcomeSeen: false, app: app)

        XCTAssertTrue(app.staticTexts["Record your farts. Turn them into songs."].waitForExistence(timeout: 5), "No Welcome on first launch")
        for point in ["One fart per Recording", "Each fart has a note", "Collect notes to unlock Songs"] {
            XCTAssertTrue(app.staticTexts[point].exists, "Welcome is missing \"\(point)\"")
        }
        XCTAssertTrue(app.buttons["Not now"].exists)
        attachScreenshot("Welcome")

        app.buttons["Allow microphone"].tap()
        let prompt = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        XCTAssertTrue(prompt.waitForExistence(timeout: 10), "No system microphone prompt")
        attachScreenshot("Microphone prompt")
        let allow = prompt.buttons["Allow"]
        (allow.exists ? allow : prompt.buttons.element(boundBy: prompt.buttons.count - 1)).tap()

        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Allow microphone"].waitForExistence(timeout: 1), "Welcome didn't close")
        XCTAssertTrue(app.buttons["record-button"].isHittable)

        // Relaunching doesn't show Welcome again.
        app.terminate()
        app.launchArguments = ["-PedosSampleStart", "new"]
        app.launch()
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Allow microphone"].exists, "Welcome showed twice")
    }

    func testNotNowThenMicrophoneOff() {
        let app = launch(microphone: "denied", welcomeSeen: false)
        XCTAssertTrue(app.buttons["Not now"].waitForExistence(timeout: 5))
        app.buttons["Not now"].tap()
        XCTAssertFalse(app.buttons["Allow microphone"].waitForExistence(timeout: 1), "Welcome didn't close")

        app.buttons["record-button"].tap()
        let alert = app.alerts["Microphone is off"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "No Microphone off alert")
        XCTAssertTrue(alert.staticTexts["Pedos needs the microphone to record. Turn it on in Settings."].exists)
        XCTAssertTrue(alert.buttons["Open Settings"].exists)
        attachScreenshot("Microphone off")

        alert.buttons["Cancel"].tap()
        XCTAssertFalse(alert.waitForExistence(timeout: 1))
        XCTAssertEqual(app.buttons["record-button"].label, "Record", "Recording started without the microphone")
    }
}

final class FirstLaunchDarkUITests: FirstLaunchUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
