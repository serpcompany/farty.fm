import XCTest

/// The Profile tab: stats counted from what's on the phone, the Songs' sources and the version.
class ProfileUITests: PedosUITestCase {
    /// Opens the Profile tab.
    private func openProfile(_ app: XCUIApplication) {
        app.tabBars.buttons["Profile"].tap()
        XCTAssertTrue(app.navigationBars["Profile"].waitForExistence(timeout: 5), "Profile is not showing")
    }

    /// What a row reads, for example "Songs unlocked, 6 of 12".
    private func row(_ id: String, in app: XCUIApplication) -> String {
        let row = app.staticTexts[id]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "No \(id) row")
        return row.label
    }

    func testANewUserHasNothingYet() {
        let app = launch(start: "new")
        openProfile(app)

        XCTAssertEqual(row("stat-recordings", in: app), "Recordings, 0")
        XCTAssertEqual(row("stat-melodic", in: app), "Melodic Recordings, 0")
        XCTAssertEqual(row("stat-notes", in: app), "Notes collected, 0")
        XCTAssertEqual(row("stat-songs", in: app), "Songs unlocked, 0 of 12")
        XCTAssertEqual(row("stat-toots", in: app), "Toots, 0")
        XCTAssertTrue(app.staticTexts["profile-new-user"].exists, "No first-fart hint for a new user")
        XCTAssertEqual(row("songs-credit", in: app), "Songs, From public-domain scores in PDMX and the Mutopia Project")
        let version = row("app-version", in: app)
        XCTAssertNotNil(version.wholeMatch(of: /Version, \d+(\.\d+)+ \(\d+\)/), "The version reads \(version)")
        attachScreenshot("profile-new")
    }

    func testStatsCountRecordingsNotesSongsAndToots() {
        let app = launch(start: "all", toots: ["mary", "ode"])
        openProfile(app)

        XCTAssertEqual(row("stat-recordings", in: app), "Recordings, 23")
        XCTAssertEqual(row("stat-melodic", in: app), "Melodic Recordings, 9")
        XCTAssertEqual(row("stat-notes", in: app), "Notes collected, 7")
        XCTAssertEqual(row("stat-songs", in: app), "Songs unlocked, 6 of 12")
        XCTAssertEqual(row("stat-toots", in: app), "Toots, 2")
        XCTAssertFalse(app.staticTexts["profile-new-user"].exists, "The new-user hint shows with Recordings")
        attachScreenshot("profile-all")
    }
}

final class ProfileDarkUITests: ProfileUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
