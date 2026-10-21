import XCTest

/// The Toots tab: empty, play, rename, delete, and a Toot whose audio is missing.
class TootsUITests: PedosUITestCase {
    func testEmptyToots() {
        let app = launch(start: "all")
        app.tabBars.buttons["Toots"].tap()
        XCTAssertTrue(app.navigationBars["Toots"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Nothing yet"].exists)
        XCTAssertTrue(app.staticTexts["Make one in Compose."].exists)
        attachScreenshot("Toots, empty")
    }

    func testRenameAndDelete() {
        let app = launch(start: "all", toots: ["twinkle", "mary"])
        app.tabBars.buttons["Toots"].tap()
        let mary = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(mary.waitForExistence(timeout: 5))
        XCTAssertEqual(tootRows(in: app), ["Mary Had a Little Lamb", "Twinkle, Twinkle, Little Star"], "Not newest first")
        // Every row shows the Song it came from, its date and its length.
        XCTAssertEqual(mary.value as? String, "Mary Had a Little Lamb · Today · 0:12")
        XCTAssertEqual(app.buttons["Twinkle, Twinkle, Little Star"].value as? String, "Twinkle, Twinkle, Little Star · Today · 0:18")
        attachScreenshot("Toots")

        // Long-press, Rename: an alert with a text field.
        openContextMenu(on: mary, showing: app.buttons["Rename"], in: app)
        attachScreenshot("Toots, menu")
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
        XCTAssertEqual(renamed.value as? String, "Mary Had a Little Lamb · Today · 0:12")
        XCTAssertFalse(mary.exists)

        // Long-press, Delete, with confirmation.
        openContextMenu(on: renamed, showing: app.buttons["Delete"], in: app)
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Delete Mary Had a Little Lamb Remix?"].waitForExistence(timeout: 5), "No delete confirmation")
        attachScreenshot("Toots, delete confirmation")
        app.buttons["Delete Toot"].tap()
        XCTAssertTrue(renamed.waitForNonExistence(timeout: 5))

        // Swipe to delete the last one.
        let twinkle = app.buttons["Twinkle, Twinkle, Little Star"]
        twinkle.swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.buttons["Delete Toot"].waitForExistence(timeout: 5))
        app.buttons["Delete Toot"].tap()
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 5))
    }

    func testMissingAudioOffersDelete() {
        let app = launch(start: "all", toots: ["ode"], failures: ["tootAudioMissing"])
        app.tabBars.buttons["Toots"].tap()
        let ode = app.buttons["Ode to Joy"]
        XCTAssertTrue(ode.waitForExistence(timeout: 5))
        XCTAssertEqual(ode.value as? String, "Ode to Joy · Audio missing")
        attachScreenshot("Toots, audio missing")

        app.buttons["play Ode to Joy"].tap()
        let alert = app.alerts["This Toot's audio is missing"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertFalse((ode.value as? String)?.contains("playing") ?? true, "It played")
        attachScreenshot("Toots, audio missing alert")
        alert.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 5))
    }

    /// Tapping a row opens the Toot: the note view, the Recordings that played it, and no Save.
    func testOpeningATootShowsItsRecordings() {
        let app = launch(start: "all", toots: ["mary"])
        app.tabBars.buttons["Toots"].tap()
        let mary = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(mary.waitForExistence(timeout: 5))
        mary.tap()
        XCTAssertTrue(app.navigationBars["Mary Had a Little Lamb"].waitForExistence(timeout: 5), "The Toot didn't open")
        XCTAssertTrue(app.staticTexts["Public domain score · PDMX"].exists)
        XCTAssertEqual(noteCount(in: app), 26)
        // Mary's pitches, lowest first, were played by fixtures 090, 084, 086 and 094.
        XCTAssertEqual(recordingRows(in: app), ["Recording 21", "Recording 19", "Recording 20", "Recording 23"])
        XCTAssertFalse(app.buttons["Save to Toots"].exists)
        XCTAssertFalse(app.buttons["Saved to Toots"].exists)
        attachScreenshot("Toot")

        let play = app.buttons["song-creator-play"]
        play.tap()
        XCTAssertEqual(play.label, "Stop", "The Toot didn't play")
    }

    func testRenameAndDeleteFromTheToot() {
        let app = launch(start: "all", toots: ["mary"])
        app.tabBars.buttons["Toots"].tap()
        let mary = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(mary.waitForExistence(timeout: 5))
        mary.tap()
        XCTAssertTrue(app.navigationBars["Mary Had a Little Lamb"].waitForExistence(timeout: 5))

        app.buttons["toot-menu"].tap()
        XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5), "No Rename in the menu")
        attachScreenshot("Toot, menu")
        app.buttons["Rename"].tap()
        let alert = app.alerts["Rename"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.textFields.firstMatch.typeText(" Remix")
        alert.buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["Mary Had a Little Lamb Remix"].waitForExistence(timeout: 5), "Not renamed")

        app.buttons["toot-menu"].tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Delete Mary Had a Little Lamb Remix?"].waitForExistence(timeout: 5), "No delete confirmation")
        app.buttons["Delete Toot"].tap()
        // Delete goes back to the list, which is now empty.
        XCTAssertTrue(app.navigationBars["Toots"].waitForExistence(timeout: 5), "Delete didn't go back")
        XCTAssertTrue(app.staticTexts["Nothing yet"].waitForExistence(timeout: 5))
    }

    /// A Recording deleted after the Toot was made stays listed as deleted, and the Toot still plays.
    func testADeletedRecordingStaysListedAndTheTootStillPlays() {
        let app = launch(start: "all", toots: ["mary"])
        app.tabBars.buttons["Toots"].tap()
        XCTAssertTrue(app.buttons["Mary Had a Little Lamb"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Recordings"].tap()
        let recording = app.buttons["Recording 19"]
        scrollTo(recording, in: app)
        recording.swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        app.buttons["Delete Recording"].tap()
        XCTAssertTrue(recording.waitForNonExistence(timeout: 5))

        app.tabBars.buttons["Toots"].tap()
        app.buttons["Mary Had a Little Lamb"].tap()
        let deleted = app.otherElements["Recording deleted"]
        XCTAssertTrue(deleted.waitForExistence(timeout: 5), "The deleted Recording isn't listed")
        XCTAssertEqual(deleted.value as? String, "plays G3")
        XCTAssertEqual(recordingRows(in: app), ["Recording 21", "Recording 20", "Recording 23"])
        attachScreenshot("Toot, Recording deleted")

        let play = app.buttons["song-creator-play"]
        play.tap()
        XCTAssertEqual(play.label, "Stop", "The Toot didn't play")
    }

    /// A Toot whose audio is missing says so on its screen, and Play and its notes can't play.
    func testATootWithMissingAudioCantPlay() {
        let app = launch(start: "all", toots: ["ode"], failures: ["tootAudioMissing"])
        app.tabBars.buttons["Toots"].tap()
        let ode = app.buttons["Ode to Joy"]
        XCTAssertTrue(ode.waitForExistence(timeout: 5))
        ode.tap()
        XCTAssertTrue(app.navigationBars["Ode to Joy"].waitForExistence(timeout: 5), "The Toot didn't open")
        let play = app.buttons["song-creator-play"]
        XCTAssertEqual(play.label, "Audio missing")
        XCTAssertFalse(play.isEnabled, "Play is enabled without audio")
        XCTAssertTrue(app.staticTexts["toot-audio-missing"].exists)

        let note = app.descendants(matching: .any)["note 1"]
        note.tap()
        XCTAssertFalse(app.staticTexts["note-caption"].exists, "A note was selected")
        XCTAssertFalse((note.value as? String)?.contains("playing") ?? true, "A note played")
        attachScreenshot("Toot, audio missing")
    }

    /// Long-presses a Toot's row until its menu shows `item`. On a slow runner a press can land
    /// as a tap, which opens the Toot, so it goes back and presses once more.
    private func openContextMenu(on row: XCUIElement, showing item: XCUIElement, in app: XCUIApplication) {
        for _ in 1...2 {
            row.press(forDuration: 1.5)
            if item.waitForExistence(timeout: 8) { return }
            if !app.navigationBars["Toots"].exists {
                app.navigationBars.buttons.element(boundBy: 0).tap()
                XCTAssertTrue(app.navigationBars["Toots"].waitForExistence(timeout: 5))
            }
        }
        XCTFail("The row's menu didn't open")
    }

    /// The Toot titles on screen, top to bottom.
    private func tootRows(in app: XCUIApplication) -> [String] {
        app.collectionViews.buttons.allElementsBoundByIndex
            .filter { !$0.identifier.hasPrefix("play ") }
            .sorted { $0.frame.minY < $1.frame.minY }
            .map(\.identifier)
    }

    private func recordingRows(in app: XCUIApplication) -> [String] {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'Recording '")).allElementsBoundByIndex
            .sorted { $0.frame.minY < $1.frame.minY }
            .map(\.identifier)
    }

    private func noteCount(in app: XCUIApplication) -> Int {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note '")).count
    }
}

final class TootsDarkUITests: TootsUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
