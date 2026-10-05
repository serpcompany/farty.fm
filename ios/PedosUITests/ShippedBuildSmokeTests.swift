import XCTest

/// The core loop on the app as it ships: real recording, saving, Recording Analysis, playback,
/// relaunch and delete, and making a Toot, with no sample data. TestFlight uploads only if this
/// passes on the build it uploads, QA until launch (`.github/workflows/testflight.yml`); the
/// test sets run it on Debug too (`-PedosLive YES`).
///
/// CI machines have no microphone, so each take is a copy of a `test-take-<id>.m4a`: a Fixture
/// Library Recording as the recorder writes it, mono 44.1 kHz AAC (all CC0 on freesound.org:
/// 090 is s/186119, 084 s/26216, 086 s/26793, 094 s/121783). 090's Recording Pitch is G3
/// (+13 cents) in the reference engine. Everything after the microphone is the real code: the
/// file store, the analysis, Auto-map, the renderer and the screens.
@MainActor
final class ShippedBuildSmokeTests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
    }

    /// Launches the app; each take is a copy of the next of these Fixture Library Recordings.
    private func launchShippedApp(takes: [String] = ["090"]) throws -> XCUIApplication {
        let files = try takes.map { id in
            try XCTUnwrap(Bundle(for: Self.self).path(forResource: "test-take-\(id)", ofType: "m4a"), "Test take \(id) isn't bundled")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-PedosLive", "YES", "-PedosTestTake", files.joined(separator: ","), "-welcomeSeen", "YES"]
        app.launch()
        return app
    }

    /// Records a take, saves it, and waits for its Result; returns the Recording's name.
    private func recordAndSave(_ take: Int, in app: XCUIApplication) throws -> String {
        app.buttons["record-button"].tap()
        waitForRecordingToStart(in: app)
        let timer = app.staticTexts["recording-timer"]
        let counted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != '0:00'"), object: timer)
        XCTAssertEqual(XCTWaiter().wait(for: [counted], timeout: 5), .completed, "The timer didn't count")
        app.buttons["stop-button"].tap()
        XCTAssertTrue(app.navigationBars["New Recording"].waitForExistence(timeout: 10), "Review didn't open for take \(take)")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["result-note"].waitForExistence(timeout: 30), "No pitch on the Result screen for take \(take)")
        return try XCTUnwrap(
            app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Recording '")).firstMatch.identifier as String?
        )
    }

    /// Record four farts (Fixture Library 090, 084, 086 and 094, as the recorder writes them),
    /// which unlocks Mary Had a Little Lamb; then make the Toot from them, rendered by the real
    /// engine, save it, and play it from the Toots tab. It's still there after a relaunch, and
    /// still plays after its Recordings are deleted; then it's deleted too.
    func testRecordFourFartsThenMakeATootThatLasts() throws {
        // Four takes, two relaunches and five deletes take about 2 minutes on this Mac.
        executionTimeAllowance = 360
        let takes = ["090", "084", "086", "094"]
        var app = try launchShippedApp(takes: takes)
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 10), "The Record tab didn't open")
        deleteEveryRecordingAndToot(in: app)
        app.tabBars.buttons["Record"].tap()
        var names: [String] = []
        for take in 1...4 {
            names.append(try recordAndSave(take, in: app))
            if take < 4 {
                app.buttons["Record another"].tap()
                XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5))
            }
        }
        XCTAssertTrue(app.staticTexts["You unlocked Mary Had a Little Lamb"].waitForExistence(timeout: 5), "Mary didn't unlock")
        attachScreenshot("Result, unlocked")

        // Try it: Song Creator renders Mary from the four Recordings and plays it.
        app.buttons["Try it"].tap()
        let play = app.buttons["song-creator-play"]
        XCTAssertTrue(play.waitForExistence(timeout: 30), "The Toot wasn't made")
        XCTAssertEqual(play.label, "Stop", "The Toot didn't start playing")
        let used = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'Recording '")).allElementsBoundByIndex.map(\.identifier)
        XCTAssertEqual(Set(used), Set(names), "Song Creator doesn't list the four Recordings")
        attachScreenshot("Song Creator")
        app.buttons["Save to Toots"].tap()
        XCTAssertTrue(app.buttons["Saved to Toots"].waitForExistence(timeout: 5), "Not saved")

        // The Toot is on the Toots tab, and plays.
        app.tabBars.buttons["Toots"].tap()
        let toot = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(toot.waitForExistence(timeout: 5), "The Toot isn't on the Toots tab")
        XCTAssertEqual(toot.value as? String, "Mary Had a Little Lamb · Today · 0:12")
        app.buttons["play Mary Had a Little Lamb"].tap()
        XCTAssertTrue((toot.value as? String)?.hasSuffix("playing") ?? false, "The Toot didn't play")
        attachScreenshot("Toots, playing")

        // Quit and open the app again: the Toot is still there.
        app.terminate()
        app = try launchShippedApp(takes: takes)
        app.tabBars.buttons["Toots"].tap()
        let kept = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(kept.waitForExistence(timeout: 10), "The Toot didn't survive a relaunch")
        XCTAssertEqual(kept.value as? String, "Mary Had a Little Lamb · Today · 0:12")

        // Deleting the Recordings it used doesn't break it: it plays its own copy of the audio.
        app.tabBars.buttons["Recordings"].tap()
        for name in names { delete(app.buttons[name], confirming: "Delete Recording", in: app) }
        app.tabBars.buttons["Toots"].tap()
        XCTAssertTrue(kept.waitForExistence(timeout: 5))
        app.buttons["play Mary Had a Little Lamb"].tap()
        XCTAssertTrue((kept.value as? String)?.hasSuffix("playing") ?? false, "The Toot didn't play without its Recordings")
        attachScreenshot("Toots, after relaunch")

        // Delete it, with a confirmation; it stays deleted.
        delete(kept, confirming: "Delete Toot", in: app)
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 5))
        app.terminate()
        app = try launchShippedApp(takes: takes)
        app.tabBars.buttons["Toots"].tap()
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 10), "The deleted Toot came back")
    }

    /// Swipes `row` to Delete, and confirms with `confirmation`.
    private func delete(_ row: XCUIElement, confirming confirmation: String, in app: XCUIApplication) {
        XCTAssertTrue(row.waitForExistence(timeout: 5), "\(row) isn't there")
        row.swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5), "No Delete")
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons[confirmation].waitForExistence(timeout: 5), "No delete confirmation")
        app.buttons[confirmation].tap()
        XCTAssertTrue(row.waitForNonExistence(timeout: 5), "\(row) wasn't deleted")
    }

    /// Deletes what an earlier, interrupted run left (CI's simulators start empty).
    private func deleteEveryRecordingAndToot(in app: XCUIApplication) {
        let tabs: [(tab: String, confirmation: String, rows: XCUIElementQuery)] = [
            ("Toots", "Delete Toot", app.collectionViews.buttons.matching(NSPredicate(format: "NOT (identifier BEGINSWITH 'play ')"))),
            ("Recordings", "Delete Recording", app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'Recording '"))),
        ]
        for (tab, confirmation, rows) in tabs {
            app.tabBars.buttons[tab].tap()
            while rows.firstMatch.waitForExistence(timeout: 2) {
                delete(app.buttons[rows.firstMatch.identifier], confirming: confirmation, in: app)
            }
        }
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Waits until recording has started, answering the microphone prompt if it appears (the
    /// first time the app records). On a slow machine the prompt can take several seconds.
    private func waitForRecordingToStart(in app: XCUIApplication) {
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        let stop = app.buttons["stop-button"]
        let deadline = Date.now.addingTimeInterval(30)
        while Date.now < deadline {
            if stop.exists { return }
            if allow.exists { allow.tap() }
            _ = stop.waitForExistence(timeout: 1)
        }
        XCTFail("Recording didn't start")
    }

    func testRecordSaveHearThePitchReplayRelaunchAndDelete() throws {
        var app = try launchShippedApp()
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 10), "The Record tab didn't open")

        // Record, then stop after the timer has counted.
        app.buttons["record-button"].tap()
        waitForRecordingToStart(in: app)
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
