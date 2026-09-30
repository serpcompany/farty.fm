import XCTest

/// Record → Review → Save → Result → Recordings, with the prototype's story order of takes.
class RecordFlowUITests: PedosUITestCase {
    /// Takes 1 (069, Noise-like) and 2 (021, Melodic C3), then deletes take 2.
    func testRecordReviewSaveResultRecordingsAndDelete() {
        let app = launch(start: "new")
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5))
        attachScreenshot("Record")

        // Record: the button turns into Stop with a timer, and the other tabs are disabled.
        app.buttons["record-button"].tap()
        XCTAssertTrue(app.buttons["Stop"].waitForExistence(timeout: 5))
        waitForTimerToCount(in: app)
        attachScreenshot("Recording")
        for tab in ["Recordings", "Compose", "Melodies"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.tabBars.buttons["Record"].isSelected, "\(tab) opened while recording")
            XCTAssertTrue(app.buttons["Stop"].exists, "Recording stopped when tapping \(tab)")
        }
        app.buttons["record-button"].tap()

        // Review: play, Save and Discard.
        XCTAssertTrue(app.navigationBars["New Recording"].waitForExistence(timeout: 5), "Review didn't open")
        XCTAssertTrue(app.staticTexts["Length 1.1 s"].exists)
        XCTAssertTrue(app.buttons["Discard"].exists)
        attachScreenshot("Review")
        // Playing lasts only as long as the 1.1 s take, so this checks the button, not the
        // state; AudioPlayerTests checks that playback starts and ends.
        app.buttons["review-play"].tap()
        attachScreenshot("Review, playing")
        XCTAssertTrue(app.buttons["review-play"].exists)

        // Save: Analyzing, then the Result for a Noise-like Recording.
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Finding your note…"].waitForExistence(timeout: 5), "No Analyzing state")
        attachScreenshot("Result, analyzing")
        XCTAssertTrue(app.staticTexts["No steady note this time"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["It's saved, but it can't play melody notes."].exists)
        XCTAssertTrue(app.navigationBars["Recording 1"].exists)
        attachScreenshot("Result, noise-like")

        // Record another: a Melodic Recording.
        app.buttons["Record another"].tap()
        XCTAssertTrue(app.buttons["record-button"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["Record"].isSelected)
        recordTake(in: app)
        saveTake(in: app)
        XCTAssertTrue(app.staticTexts["result-note"].waitForExistence(timeout: 5), "No Result for a Melodic Recording")
        XCTAssertEqual(app.staticTexts["result-note"].label, "C3")
        XCTAssertTrue(app.staticTexts["Your note"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["pitch-strip"].label, "Notes collected: C. New: C")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'notes covered'")).firstMatch.exists, "No Pitch Coverage change")
        attachScreenshot("Result, Melodic")

        // Done: the Recordings tab, newest first.
        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Recordings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["Recordings"].isSelected)
        XCTAssertTrue(app.staticTexts["1 Melodic Recording across 1 note"].exists)
        XCTAssertTrue(app.staticTexts["2 Recordings"].exists)
        XCTAssertTrue(app.staticTexts["C3"].exists)
        XCTAssertTrue(app.staticTexts["noise-like"].exists)
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'Recording '"))
        XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), ["Recording 2", "Recording 1"])
        attachScreenshot("Recordings")

        // Swipe to delete, with confirmation.
        app.buttons["Recording 2"].swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Delete Recording 2?"].waitForExistence(timeout: 5), "No delete confirmation")
        attachScreenshot("Delete confirmation")
        app.buttons["Delete Recording"].tap()
        XCTAssertTrue(app.buttons["Recording 2"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Recording 1"].exists)
        XCTAssertTrue(app.staticTexts["0 Melodic Recordings across 0 notes"].exists)
    }

    /// Take 6 (059) is Melodic, and a second fart was cut off.
    func testResultSaysWhenTheFirstFartWasKept() {
        let app = launch(start: "5")
        recordTake(in: app)
        saveTake(in: app)
        XCTAssertTrue(app.staticTexts["result-note"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["result-note"].label, "G4")
        let keptFirst = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'We kept the first fart'"))
        XCTAssertTrue(keptFirst.firstMatch.exists, "No \"We kept the first fart\"")
        attachScreenshot("Result, first fart kept")

        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Recordings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Recording 6"].value.map { "\($0)".contains("first fart used") } ?? false)
    }

    /// Take 8 (086) is the 6th Melodic Recording in story order, and unlocks Mary Had a Little Lamb.
    func testSixthMelodicRecordingUnlocksMary() {
        let app = launch(start: "7")
        recordTake(in: app)
        saveTake(in: app)
        XCTAssertTrue(app.staticTexts["You unlocked Mary Had a Little Lamb"].waitForExistence(timeout: 5), "Mary didn't unlock")
        XCTAssertTrue(app.buttons["Try it"].exists)
        XCTAssertTrue(app.buttons["Done"].exists)
        attachScreenshot("Result, unlocked")

        app.buttons["Try it"].tap()
        XCTAssertTrue(app.navigationBars["Compose"].waitForExistence(timeout: 5), "Try it didn't open Compose")
        XCTAssertTrue(app.tabBars.buttons["Compose"].isSelected)
    }
}

final class RecordFlowDarkUITests: RecordFlowUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
