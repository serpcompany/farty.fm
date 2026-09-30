import XCTest

/// Coming back to the foreground lands on the Record tab, except over Review and Result, and
/// playback stops in the background.
final class ForegroundUITests: PedosUITestCase {
    /// Sends the app to the background and brings it back.
    private func leaveAndComeBack(_ app: XCUIApplication) {
        XCUIDevice.shared.press(.home)
        _ = app.wait(for: .runningBackgroundSuspended, timeout: 5)
        XCTAssertNotEqual(app.state, .runningForeground, "The app didn't go to the background")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
    }

    func testComingBackLandsOnRecordAndPlaybackStopped() {
        let app = launch(start: "all", toots: ["ode"])
        app.tabBars.buttons["Toots"].tap()
        let ode = app.buttons["Ode to Joy"]
        XCTAssertTrue(ode.waitForExistence(timeout: 5))
        app.buttons["play Ode to Joy"].tap()
        XCTAssertTrue((ode.value as? String)?.hasSuffix("playing") ?? false, "The 18 s Toot didn't start")

        leaveAndComeBack(app)
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5), "Didn't come back on Record")
        XCTAssertTrue(app.tabBars.buttons["Record"].isSelected)

        app.tabBars.buttons["Toots"].tap()
        XCTAssertTrue(ode.waitForExistence(timeout: 5))
        XCTAssertFalse((ode.value as? String)?.contains("playing") ?? true, "Playback didn't stop in the background")
    }

    func testComingBackClosesALockedSongSheet() {
        let app = launch(start: "all")
        app.tabBars.buttons["Compose"].tap()
        let birthday = app.buttons["Happy Birthday"]
        XCTAssertTrue(app.staticTexts["Unlocked · 6"].waitForExistence(timeout: 5))
        scrollTo(birthday, in: app)
        birthday.tap()
        XCTAssertTrue(app.staticTexts["locked-song-needs"].waitForExistence(timeout: 5), "No locked Song sheet")

        leaveAndComeBack(app)
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5), "Didn't come back on Record")
        XCTAssertTrue(app.tabBars.buttons["Record"].isSelected)
        XCTAssertTrue(app.buttons["record-button"].isHittable, "Something covers the Record tab")
        XCTAssertFalse(app.staticTexts["locked-song-needs"].exists, "The locked Song sheet stayed open")
    }

    func testComingBackLeavesReviewOpen() {
        let app = launch(start: "new")
        recordTake(in: app)
        XCTAssertTrue(app.navigationBars["New Recording"].waitForExistence(timeout: 5), "Review didn't open")

        leaveAndComeBack(app)
        XCTAssertTrue(app.navigationBars["New Recording"].waitForExistence(timeout: 5), "Review closed")
        XCTAssertTrue(app.buttons["Save"].exists)
    }
}
