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

    /// Stopping playback in the background is checked by `SampleAppModelTests`
    /// (`testGoingToTheBackgroundStopsPlayback`): here, switching back to Record would stop it anyway.
    func testComingBackLandsOnRecord() {
        let app = launch(start: "all", toots: ["ode"])
        app.tabBars.buttons["Toots"].tap()
        XCTAssertTrue(app.buttons["Ode to Joy"].waitForExistence(timeout: 5))

        leaveAndComeBack(app)
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5), "Didn't come back on Record")
        XCTAssertTrue(app.tabBars.buttons["Record"].isSelected)
        XCTAssertTrue(app.buttons["record-button"].isHittable)
    }

    /// A Delete confirmation on a Toot's screen doesn't survive a trip to the background.
    func testComingBackClosesATootsDeleteConfirmation() {
        let app = launch(start: "all", toots: ["mary"])
        app.tabBars.buttons["Toots"].tap()
        let mary = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(mary.waitForExistence(timeout: 5))
        mary.tap()
        app.buttons["toot-menu"].tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons["Delete Toot"].waitForExistence(timeout: 5), "No delete confirmation")

        leaveAndComeBack(app)
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5), "Didn't come back on Record")
        XCTAssertTrue(app.tabBars.buttons["Record"].isSelected)
        XCTAssertFalse(app.buttons["Delete Toot"].waitForExistence(timeout: 2), "The Delete confirmation stayed open")
        XCTAssertTrue(app.buttons["record-button"].isHittable, "Something covers the Record tab")

        // The Toot is still there: its screen is still open on the Toots tab, and so is its row.
        app.tabBars.buttons["Toots"].tap()
        XCTAssertTrue(app.navigationBars["Mary Had a Little Lamb"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(mary.waitForExistence(timeout: 5), "The Toot was deleted")
    }

    func testComingBackClosesALockedSongSheet() {
        let app = launch(start: "8")
        app.tabBars.buttons["Compose"].tap()
        let birthday = app.buttons["Happy Birthday"]
        XCTAssertTrue(app.staticTexts["Unlocked · 7"].waitForExistence(timeout: 5))
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
