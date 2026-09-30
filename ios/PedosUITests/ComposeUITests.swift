import XCTest

/// Compose: the Songs list, a locked Song's sheet, and Song Creator.
class ComposeUITests: PedosUITestCase {
    /// A new user: every Song is locked, and the list and the sheet say how to start.
    func testNoMelodicRecordingsYet() {
        let app = launch(start: "new")
        app.tabBars.buttons["Compose"].tap()
        XCTAssertTrue(app.staticTexts["No Melodic Recordings yet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Record a few farts with a clear note to start unlocking Songs."].exists)
        XCTAssertTrue(app.staticTexts["Locked · 12"].exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Unlocked'")).firstMatch.exists)
        attachScreenshot("Compose, no Melodic Recordings")

        let mary = app.buttons["Mary Had a Little Lamb"]
        scrollTo(mary, in: app)
        XCTAssertEqual(mary.value as? String, "Locked. 0 of 4 notes covered")
        mary.tap()
        XCTAssertTrue(app.staticTexts["locked-song-needs"].waitForExistence(timeout: 5), "No locked Song sheet")
        XCTAssertEqual(app.staticTexts["locked-song-needs"].label, "Record a fart with a clear note to start.")
        attachScreenshot("Locked Song, no Melodic Recordings")
    }

    /// Two Melodic Recordings: nothing unlocked yet, and each row names the nearest missing notes.
    func testNoneUnlocked() {
        let app = launch(start: "few")
        app.tabBars.buttons["Compose"].tap()
        XCTAssertTrue(app.staticTexts["Locked · 12"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["No Melodic Recordings yet"].exists)
        // Mary needs 4 notes and has 2: the closest to unlocking, first.
        let mary = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(mary.exists)
        XCTAssertEqual(mary.value as? String, "Locked. 2 of 4 notes covered. Needs C3 and D3")
        let birthday = app.buttons["Happy Birthday"]
        scrollTo(birthday, in: app)
        XCTAssertTrue((birthday.value as? String)?.hasSuffix("and 3 more") ?? false, "\(String(describing: birthday.value))")
        app.swipeDown()
        attachScreenshot("Compose, none unlocked")
    }

    /// All 23 Recordings: 6 Unlocked Songs first, then 6 locked ones. Search and sort.
    func testSongsSearchAndSort() {
        let app = launch(start: "all")
        app.tabBars.buttons["Compose"].tap()
        XCTAssertTrue(app.staticTexts["Unlocked · 6"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Locked · 6"].exists)
        let unlocked = ["Mary Had a Little Lamb", "Jingle Bells", "When the Saints Go Marching In", "Ode to Joy",
                        "Twinkle, Twinkle, Little Star", "Row, Row, Row Your Boat"]
        XCTAssertEqual(songRows(in: app).prefix(6), ArraySlice(unlocked), "Unlocked Songs aren't first, fewest notes first")
        XCTAssertTrue(app.buttons["Mary Had a Little Lamb"].label.contains("Ready"))
        XCTAssertEqual(app.buttons["Frère Jacques"].value as? String, "Locked. 6 of 7 notes covered. Needs D♯3")
        attachScreenshot("Compose, Songs")

        // Compose has a large title like the other tabs; search appears when the list is pulled down.
        let title = app.navigationBars["Compose"].staticTexts["Compose"]
        XCTAssertGreaterThan(title.frame.height, 30, "Compose's title isn't large")
        let search = app.searchFields["Search Songs"]
        if !search.isHittable { app.collectionViews.firstMatch.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 5), "No search field")
        search.tap()
        search.typeText("jingle")
        XCTAssertTrue(app.buttons["Jingle Bells"].waitForExistence(timeout: 5))
        XCTAssertEqual(songRows(in: app), ["Jingle Bells"])
        attachScreenshot("Compose, search")

        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6) + "zzz")
        XCTAssertTrue(app.staticTexts["No Results for “zzz”"].waitForExistence(timeout: 5), "No empty search state")
        XCTAssertEqual(songRows(in: app), [])
        attachScreenshot("Compose, no search results")

        // Closing the search brings every Song back.
        app.buttons["Close"].tap()
        XCTAssertTrue(app.buttons["Mary Had a Little Lamb"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.searchFields["Search Songs"].value as? String, "Search Songs", "The search wasn't cleared")
        app.buttons["sort-songs"].tap()
        XCTAssertTrue(app.buttons["A–Z"].waitForExistence(timeout: 5))
        attachScreenshot("Compose, sort menu")
        app.buttons["A–Z"].tap()
        let alphabetical = unlocked.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        let sorted = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in Array(self.songRows(in: app).prefix(6)) == alphabetical },
            object: nil
        )
        XCTAssertEqual(XCTWaiter().wait(for: [sorted], timeout: 5), .completed, "Not sorted A–Z: \(songRows(in: app))")
    }

    /// A locked Song opens its sheet, which names every missing note and has no way to play it.
    func testLockedSongShowsMissingNotesAndCannotPlay() {
        let app = launch(start: "all")
        app.tabBars.buttons["Compose"].tap()
        let birthday = app.buttons["Happy Birthday"]
        XCTAssertTrue(app.staticTexts["Unlocked · 6"].waitForExistence(timeout: 5))
        scrollTo(birthday, in: app)
        XCTAssertEqual(birthday.value as? String, "Locked. 6 of 8 notes covered. Needs D3 and E3")
        birthday.tap()

        XCTAssertTrue(app.staticTexts["locked-song-needs"].waitForExistence(timeout: 5), "No locked Song sheet")
        XCTAssertEqual(app.staticTexts["locked-song-needs"].label, "Needs a fart near D3 and E3.")
        XCTAssertTrue(app.navigationBars["Happy Birthday"].exists)
        XCTAssertTrue(app.staticTexts["6 of 8 notes covered"].exists)
        XCTAssertEqual(
            app.descendants(matching: .any)["pitch-strip"].label,
            "Notes collected: C, E, F♯, G, G♯, and B. Needed: D and E"
        )
        // Locked Songs can't be played: no Song Creator, no play button.
        XCTAssertFalse(app.buttons["song-creator-play"].exists)
        XCTAssertFalse(app.staticTexts["Making your Toot…"].exists)
        attachScreenshot("Locked Song")

        app.buttons["locked-song-record"].tap()
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5), "Record didn't go to the Record tab")
        XCTAssertTrue(app.tabBars.buttons["Record"].isSelected)
        XCTAssertFalse(app.staticTexts["locked-song-needs"].exists, "The sheet stayed open")
    }

    /// An Unlocked Song opens Song Creator, which makes the Toot, plays it once, and saves it.
    func testUnlockedSongPlaysAndSavesToToots() {
        // A 4 s simulated render keeps "Making your Toot…" up long enough to check.
        let app = launch(start: "all", makingSeconds: 4)
        app.tabBars.buttons["Compose"].tap()
        let ode = app.buttons["Ode to Joy"]
        XCTAssertTrue(ode.waitForExistence(timeout: 5))
        ode.tap()
        XCTAssertTrue(app.navigationBars["Ode to Joy"].waitForExistence(timeout: 5), "No Song Creator")
        XCTAssertTrue(app.staticTexts["Making your Toot…"].waitForExistence(timeout: 3), "No making state")
        attachScreenshot("Song Creator, making")

        // Ready: it plays once by itself.
        let play = app.buttons["song-creator-play"]
        XCTAssertTrue(play.waitForExistence(timeout: 10), "The Toot wasn't made")
        XCTAssertEqual(play.label, "Stop", "It didn't start playing")
        XCTAssertTrue(app.staticTexts["Playing"].exists)
        XCTAssertTrue(app.staticTexts["Public domain score · PDMX"].exists)
        XCTAssertTrue(app.staticTexts["5 of your Recordings, one per note"].exists)
        XCTAssertEqual(notes(in: app).count, 30, "each note is its own element")
        // With every fixture, the list shows the Recordings the stand-in render plays, lowest
        // pitch first: fixtures 090, 084, 013, 086 and 094.
        XCTAssertEqual(
            app.staticTexts["simulated-toot"].label,
            "Simulated Toot: the design prototype's render of this Song, with these Recordings."
        )
        XCTAssertEqual(recordingRows(in: app), ["Recording 21", "Recording 19", "Recording 3", "Recording 20", "Recording 23"])
        attachScreenshot("Song Creator, playing")

        // A row plays that fart alone. Recording 3 (fixture 013) is the longest, 1.1 s.
        let row = app.buttons["Recording 3"]
        row.tap()
        XCTAssertTrue((row.value as? String)?.contains("playing") ?? false, "The row didn't play its Recording")
        XCTAssertEqual(play.label, "Play")

        app.buttons["Save to Toots"].tap()
        let saved = app.buttons["Saved to Toots"]
        XCTAssertTrue(saved.waitForExistence(timeout: 5), "Not saved")
        XCTAssertFalse(saved.isEnabled, "It can be saved twice")
        attachScreenshot("Song Creator, saved")

        // The Toot is on the Toots tab, and plays.
        app.tabBars.buttons["Toots"].tap()
        let toot = app.buttons["Ode to Joy"]
        XCTAssertTrue(toot.waitForExistence(timeout: 5), "The Toot isn't on the Toots tab")
        XCTAssertEqual(toot.value as? String, "Ode to Joy · Today · 0:18")
        app.buttons["play Ode to Joy"].tap()
        XCTAssertTrue((toot.value as? String)?.hasSuffix("playing") ?? false, "The Toot didn't play")
        attachScreenshot("Toots, playing")
    }

    /// Tapping a note plays just that note as rendered, selects it, says what it is, and
    /// highlights the Recording that plays it.
    func testTappingANotePlaysItAndHighlightsItsRecording() {
        let app = launch(start: "all")
        openSongCreator("Mary Had a Little Lamb", in: app)
        let play = app.buttons["song-creator-play"]
        XCTAssertEqual(play.label, "Stop", "Mary isn't playing")

        // Mary's last note lasts 1.4 s: fixture 090 (Recording 21, G3) moved to F3.
        let note = app.descendants(matching: .any)["note 26"]
        XCTAssertTrue(note.exists)
        XCTAssertEqual(note.label, "F3 at 10.0 s, Recording 21")
        note.tap()
        XCTAssertTrue((note.value as? String)?.contains("playing") ?? false, "The note didn't play")
        XCTAssertTrue((note.value as? String)?.contains("selected") ?? false, "The note isn't selected")
        XCTAssertEqual(play.label, "Play", "The whole Toot kept playing")
        XCTAssertEqual(app.staticTexts["note-caption"].label, "F3 · Recording 21 (G3), shifted −2.1 semitones · 1.4 s")
        XCTAssertTrue((app.buttons["Recording 21"].value as? String)?.contains("highlighted") ?? false, "Its Recording isn't highlighted")
        XCTAssertFalse((app.buttons["Recording 23"].value as? String)?.contains("highlighted") ?? true)
        attachScreenshot("Song Creator, note selected")
    }

    /// Tapping a Recording plays it alone and highlights the notes it plays.
    func testTappingARecordingHighlightsItsNotes() {
        let app = launch(start: "all")
        openSongCreator("Mary Had a Little Lamb", in: app)
        // Recording 21 (fixture 090) is the first row, so the note view stays on screen.
        app.buttons["Recording 21"].tap()
        let highlighted = notes(in: app).filter { ($0.value as? String)?.contains("highlighted") ?? false }
        XCTAssertFalse(highlighted.isEmpty, "No notes highlighted")
        XCTAssertTrue(highlighted.allSatisfy { $0.label.hasSuffix("Recording 21") }, "Other Recordings' notes are highlighted")
        XCTAssertEqual(highlighted.count, notes(in: app).filter { $0.label.hasSuffix("Recording 21") }.count, "Not all its notes are highlighted")
        XCTAssertTrue((app.buttons["Recording 21"].value as? String)?.contains("highlighted") ?? false)
        attachScreenshot("Song Creator, Recording highlighted")
        XCTAssertFalse(app.staticTexts["note-caption"].exists, "A note is selected")
    }

    private func openSongCreator(_ title: String, in app: XCUIApplication) {
        app.tabBars.buttons["Compose"].tap()
        let song = app.buttons[title]
        XCTAssertTrue(song.waitForExistence(timeout: 5))
        song.tap()
        XCTAssertTrue(app.buttons["song-creator-play"].waitForExistence(timeout: 10), "\(title) wasn't made")
    }

    private func notes(in app: XCUIApplication) -> [XCUIElement] {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note '")).allElementsBoundByIndex
    }

    func testCouldNotMakeTootThenTryAgain() {
        let app = launch(start: "all", failures: ["couldNotMakeToot"])
        app.tabBars.buttons["Compose"].tap()
        let mary = app.buttons["Mary Had a Little Lamb"]
        XCTAssertTrue(mary.waitForExistence(timeout: 5))
        mary.tap()
        XCTAssertTrue(app.staticTexts["Couldn't make this Toot"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Save to Toots"].exists)
        attachScreenshot("Song Creator, couldn't make")

        app.buttons["Try again"].tap()
        XCTAssertTrue(app.buttons["song-creator-play"].waitForExistence(timeout: 5), "Try again didn't make it")
        XCTAssertTrue(app.buttons["Save to Toots"].exists)
    }

    /// Song Creator's Recordings used, top to bottom.
    private func recordingRows(in app: XCUIApplication) -> [String] {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'Recording '")).allElementsBoundByIndex
            .sorted { $0.frame.minY < $1.frame.minY }
            .map(\.identifier)
    }

    /// The Song titles of the rows on screen, top to bottom.
    private func songRows(in app: XCUIApplication) -> [String] {
        let titles = [
            "Twinkle, Twinkle, Little Star", "Mary Had a Little Lamb", "Jingle Bells", "Happy Birthday",
            "Frère Jacques", "When the Saints Go Marching In", "Row, Row, Row Your Boat", "Ode to Joy",
            "We Wish You a Merry Christmas", "Amazing Grace", "Für Elise", "Auld Lang Syne",
        ]
        return app.buttons.matching(NSPredicate(format: "identifier IN %@", titles)).allElementsBoundByIndex
            .filter(\.exists)
            .sorted { $0.frame.minY < $1.frame.minY }
            .map(\.identifier)
    }
}

final class ComposeDarkUITests: ComposeUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
