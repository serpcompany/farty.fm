import XCTest

/// The Recordings tab: empty, and with all 23 Fixture Library Recordings.
class RecordingsUITests: PedosUITestCase {
    func testEmptyRecordings() {
        let app = launch(start: "new")
        app.tabBars.buttons["Recordings"].tap()
        XCTAssertTrue(app.staticTexts["No Recordings yet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Go to the Record tab and tap the red button."].exists)
        attachScreenshot("Recordings, empty")
    }

    func testAllRecordingsAndPlayback() {
        let app = launch(start: "all")
        app.tabBars.buttons["Recordings"].tap()
        // Notes count with their octave: E2, F♯2, C3, G3, G♯3, B3 and G4.
        XCTAssertTrue(app.staticTexts["9 Melodic Recordings across 7 notes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["23 Recordings"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["pitch-strip"].exists, "The Recordings tab still shows the pitch strip")
        XCTAssertTrue(app.buttons["Recording 23"].value.map { "\($0)".contains("B3") } ?? false)
        XCTAssertTrue(app.buttons["Recording 22"].value.map { "\($0)".contains("noise-like") } ?? false)
        attachScreenshot("Recordings, all 23")

        // Recording 17 is the longest take (2 s): tapping it plays it and highlights the row
        // until it ends. The row is marked playing as soon as it's tapped.
        let row = app.buttons["Recording 17"]
        scrollTo(row, in: app)
        XCTAssertTrue(row.value.map { "\($0)".contains("first fart used") } ?? false)
        row.tap()
        XCTAssertTrue(row.value.map { "\($0)".contains("playing") } ?? false, "The row isn't playing")
        attachScreenshot("Recordings, playing")
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "NOT (value CONTAINS 'playing')"), object: row)
        XCTAssertEqual(XCTWaiter().wait(for: [finished], timeout: 5), .completed, "The row didn't stop playing at the end")
    }
}

final class RecordingsDarkUITests: RecordingsUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
