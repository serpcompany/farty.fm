import XCTest

/// Melodies: empty, play, rename, delete, and a melody whose audio is missing.
class MelodiesUITests: PedosUITestCase {
    func testEmptyMelodies() {
        let app = launch(start: "all")
        app.tabBars.buttons["Melodies"].tap()
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Make one in Compose."].exists)
        attachScreenshot("Melodies, empty")
    }

    func testRenameAndDelete() {
        let app = launch(start: "all", melodies: ["twinkle", "mary"])
        app.tabBars.buttons["Melodies"].tap()
        let mary = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(mary.waitForExistence(timeout: 5))
        XCTAssertEqual(melodyRows(in: app), ["Mary Had a Little Lamb", "Twinkle, Twinkle, Little Star"], "Not newest first")
        attachScreenshot("Melodies")

        // Long-press, Rename: an alert with a text field.
        mary.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5), "No Rename in the menu")
        attachScreenshot("Melodies, menu")
        app.buttons["Rename"].tap()
        let alert = app.alerts["Rename"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "No Rename alert")
        let field = alert.textFields.firstMatch
        XCTAssertEqual(field.value as? String, "Mary Had a Little Lamb")
        field.typeText(" Remix")
        attachScreenshot("Rename")
        alert.buttons["Save"].tap()
        let renamed = app.buttons["Mary Had a Little Lamb Remix"]
        XCTAssertTrue(renamed.waitForExistence(timeout: 5), "Not renamed")
        XCTAssertTrue((renamed.value as? String)?.hasPrefix("Mary Had a Little Lamb · Today") ?? false, "\(String(describing: renamed.value))")
        XCTAssertFalse(mary.exists)

        // Long-press, Delete, with confirmation.
        renamed.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Delete Mary Had a Little Lamb Remix?"].waitForExistence(timeout: 5), "No delete confirmation")
        attachScreenshot("Melodies, delete confirmation")
        app.buttons["Delete Melody"].tap()
        XCTAssertTrue(renamed.waitForNonExistence(timeout: 5))

        // Swipe to delete the last one.
        let twinkle = app.buttons["Twinkle, Twinkle, Little Star"]
        twinkle.swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons["Delete Melody"].waitForExistence(timeout: 5))
        app.buttons["Delete Melody"].tap()
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 5))
    }

    func testMissingAudioOffersDelete() {
        let app = launch(start: "all", melodies: ["ode"], failures: ["melodyAudioMissing"])
        app.tabBars.buttons["Melodies"].tap()
        let ode = app.buttons["Ode to Joy"]
        XCTAssertTrue(ode.waitForExistence(timeout: 5))
        XCTAssertEqual(ode.value as? String, "Audio missing")
        attachScreenshot("Melodies, audio missing")

        ode.tap()
        let alert = app.alerts["This melody's audio is missing"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertFalse((ode.value as? String)?.contains("playing") ?? true, "It played")
        attachScreenshot("Melodies, audio missing alert")
        alert.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 5))
    }

    /// The melody titles on screen, top to bottom.
    private func melodyRows(in app: XCUIApplication) -> [String] {
        app.collectionViews.buttons.allElementsBoundByIndex
            .sorted { $0.frame.minY < $1.frame.minY }
            .map(\.identifier)
    }
}

final class MelodiesDarkUITests: MelodiesUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
