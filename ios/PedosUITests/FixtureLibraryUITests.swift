import XCTest

/// "Load the Fixture Library" on the Profile tab, as QA builds have it: the 23 test farts become
/// Recordings, analyzed by the real Recording Analysis. Runs on Debug with -PedosLive, in a fresh
/// folder so it starts empty.
@MainActor
final class FixtureLibraryUITests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
        // Loading and analyzing 23 Recordings takes about 30 s on a Debug build, longer on CI.
        executionTimeAllowance = 300
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testLoadingTheFixtureLibraryGivesAll23WithTheirPitches() {
        let app = XCUIApplication()
        app.launchArguments = ["-PedosLive", "YES", "-PedosFreshStore", "YES", "-welcomeSeen", "YES"]
        app.launch()

        app.tabBars.buttons["Profile"].tap()
        let load = app.buttons["load-fixture-library"]
        XCTAssertTrue(load.waitForExistence(timeout: 10), "No Load the Fixture Library button")
        XCTAssertTrue(load.label.contains("0 of 23"), load.label)
        load.tap()

        // Every fixture is loaded and analyzed.
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'Fixture Library loaded'"), object: load)
        XCTAssertEqual(XCTWaiter().wait(for: [loaded], timeout: 120), .completed, "Loading didn't finish: \(load.label)")
        XCTAssertTrue(load.label.contains("23 of 23"), load.label)
        attachScreenshot("Profile, Fixture Library loaded")

        // The Recordings tab: all 23, with the reference engine's 9 Melodic Recordings.
        app.tabBars.buttons["Recordings"].tap()
        XCTAssertTrue(app.staticTexts["23 Recordings"].waitForExistence(timeout: 10))
        let melodic = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH '9 Melodic Recordings'")).firstMatch
        XCTAssertTrue(melodic.waitForExistence(timeout: 30), "Not 9 Melodic Recordings")
        attachScreenshot("Recordings, Fixture Library")
    }
}
