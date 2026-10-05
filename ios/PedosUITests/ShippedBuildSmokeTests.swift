import XCTest

/// The core loop on the app as it ships: real recording, saving, Recording Analysis, playback,
/// relaunch and delete, with no sample data. TestFlight uploads only if this passes on the
/// Release build (`.github/workflows/testflight.yml`); the full suite runs it on Debug too
/// (`-PedosLive YES`).
///
/// CI machines have no microphone, so each take is a copy of `test-take-090.m4a`: Fixture Library
/// Recording 090 (CC0, freesound.org/s/186119) as the recorder writes it, mono 44.1 kHz AAC.
/// Its Recording Pitch is G3 (+13 cents) in the reference engine. Everything after the
/// microphone is the real code: the file store, the analysis and the screens.
@MainActor
final class ShippedBuildSmokeTests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
    }

    private func launchShippedApp() throws -> XCUIApplication {
        let take = try XCTUnwrap(
            Bundle(for: Self.self).path(forResource: "test-take-090", ofType: "m4a"), "The test take isn't bundled"
        )
        let app = XCUIApplication()
        app.launchArguments = ["-PedosLive", "YES", "-PedosTestTake", take, "-welcomeSeen", "YES"]
        app.launch()
        return app
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Answers the microphone prompt, which appears the first time the app records.
    private func allowMicrophoneIfAsked() {
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
    }

    func testRecordSaveHearThePitchReplayRelaunchAndDelete() throws {
        var app = try launchShippedApp()
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 10), "The Record tab didn't open")

        // Record, then stop after the timer has counted.
        app.buttons["record-button"].tap()
        allowMicrophoneIfAsked()
        XCTAssertTrue(app.buttons["stop-button"].waitForExistence(timeout: 10), "Recording didn't start")
        let timer = app.staticTexts["recording-timer"]
        let counted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != '0:00'"), object: timer)
        XCTAssertEqual(XCTWaiter().wait(for: [counted], timeout: 5), .completed, "The timer didn't count")
        app.buttons["stop-button"].tap()

        // Review, then Save: the Result shows the Recording Pitch the analysis found.
        XCTAssertTrue(app.navigationBars["New Recording"].waitForExistence(timeout: 10), "Review didn't open")
        app.buttons["Save"].tap()
        let note = app.staticTexts["result-note"]
        XCTAssertTrue(note.waitForExistence(timeout: 30), "No pitch on the Result screen")
        XCTAssertEqual(note.label, "G3")
        attachScreenshot("Result")
        let name = try XCTUnwrap(
            app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Recording '")).firstMatch.identifier
                as String?
        )
        XCTAssertFalse(name.isEmpty)

        // The Recordings tab lists it with its pitch, and tapping it plays it.
        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Recordings"].waitForExistence(timeout: 10))
        let row = app.buttons[name]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "\(name) isn't on the Recordings tab")
        XCTAssertTrue("\(row.value ?? "")".contains("G3"), "\(name) doesn't show its pitch: \(row.value ?? "")")
        row.tap()
        XCTAssertTrue("\(row.value ?? "")".contains("playing"), "\(name) didn't play")
        attachScreenshot("Recordings, playing")

        // It's still there, with its pitch, after the app is quit and opened again.
        app.terminate()
        app = try launchShippedApp()
        app.tabBars.buttons["Recordings"].tap()
        let relaunchedRow = app.buttons[name]
        XCTAssertTrue(relaunchedRow.waitForExistence(timeout: 10), "\(name) didn't survive a relaunch")
        XCTAssertTrue("\(relaunchedRow.value ?? "")".contains("G3"), "\(name) lost its pitch on relaunch")

        // Delete it.
        relaunchedRow.swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons["Delete Recording"].waitForExistence(timeout: 5), "No delete confirmation")
        app.buttons["Delete Recording"].tap()
        XCTAssertTrue(relaunchedRow.waitForNonExistence(timeout: 5), "\(name) wasn't deleted")
    }
}
