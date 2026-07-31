import Foundation
import MelodyRenderKit
import RecordingAnalysisKit
import XCTest

final class MelodyFitPlannerTests: XCTestCase {
    func testCatalogHasStableValidMelodyPlans() {
        XCTAssertEqual(CuratedMelodyCatalog.all.map(\.id), ["mary-lamb", "twinkle", "ode-to-joy"])
        XCTAssertEqual(Set(CuratedMelodyCatalog.all.map(\.id)).count, CuratedMelodyCatalog.all.count)
        XCTAssertTrue(CuratedMelodyCatalog.all.allSatisfy { melody in
            melody.bpm.isFinite && melody.bpm > 0
                && !melody.events.isEmpty
                && melody.events.allSatisfy { $0.beats.isFinite && $0.beats > 0 }
        })
    }

    func testPlanRejectsNonPositiveTempo() throws {
        let melody = CuratedMelody(
            id: "invalid-tempo",
            title: "Invalid Tempo",
            provenance: "Test fixture",
            bpm: 0,
            events: [MelodyEvent(60, 1)]
        )
        let sourceSet = try MelodyFitPlanner.sourceSet(
            mode: .chooseIndividual,
            melody: melody,
            candidates: [makeCandidate(id: "source", midiNote: 60)]
        )

        XCTAssertThrowsError(try MelodyFitPlanner.plan(melody: melody, sourceSet: sourceSet)) { error in
            guard case MelodyRenderError.invalidTempo = error else {
                return XCTFail("Expected invalidTempo, got \(error)")
            }
        }
    }

    func testPlanRejectsInvalidEventDuration() throws {
        let melody = CuratedMelody(
            id: "invalid-event",
            title: "Invalid Event",
            provenance: "Test fixture",
            bpm: 120,
            events: [MelodyEvent(60, 1), MelodyEvent(nil, 0)]
        )
        let sourceSet = try MelodyFitPlanner.sourceSet(
            mode: .chooseIndividual,
            melody: melody,
            candidates: [makeCandidate(id: "source", midiNote: 60)]
        )

        XCTAssertThrowsError(try MelodyFitPlanner.plan(melody: melody, sourceSet: sourceSet)) { error in
            guard case MelodyRenderError.invalidEventDuration(let index) = error else {
                return XCTFail("Expected invalidEventDuration, got \(error)")
            }
            XCTAssertEqual(index, 1)
        }
    }

    func testUseAllRotatesAcrossSourcesAndSkipsRests() throws {
        let melody = CuratedMelody(
            id: "abc",
            title: "Rotation",
            provenance: "Test fixture",
            bpm: 120,
            events: [MelodyEvent(60, 1), MelodyEvent(nil, 1), MelodyEvent(62, 1), MelodyEvent(64, 2)]
        )
        let sourceSet = try MelodyFitPlanner.sourceSet(
            mode: .useAll,
            melody: melody,
            candidates: [
                makeCandidate(id: "a", midiNote: 60),
                makeCandidate(id: "b", midiNote: 60),
                makeCandidate(id: "c", midiNote: 60),
            ]
        )

        let (assignments, facts) = try MelodyFitPlanner.plan(melody: melody, sourceSet: sourceSet)

        XCTAssertEqual(assignments.map(\.eventIndex), [0, 2, 3])
        XCTAssertEqual(assignments.map(\.recordingID), ["a", "b", "c"])
        XCTAssertEqual(assignments.map(\.durationSeconds), [0.5, 0.5, 1])
        XCTAssertEqual(facts.usedRecordingIDs, ["a", "b", "c"])
        XCTAssertEqual(facts.sourceCoverageRatio, 1)
        XCTAssertEqual(facts.consecutiveSourceReuseCount, 0)
    }

    func testRecommendBestFitBalancesUseBeforeReusingClosestPitch() throws {
        let melody = CuratedMelody(
            id: "balanced",
            title: "Balanced",
            provenance: "Test fixture",
            bpm: 120,
            events: [MelodyEvent(60, 1), MelodyEvent(64, 1), MelodyEvent(67, 1), MelodyEvent(60, 1)]
        )
        let sourceSet = try MelodyFitPlanner.sourceSet(
            mode: .recommendBestFit,
            melody: melody,
            candidates: [
                makeCandidate(id: "low", midiNote: 60),
                makeCandidate(id: "middle", midiNote: 64),
                makeCandidate(id: "high", midiNote: 67),
            ]
        )

        let (assignments, facts) = try MelodyFitPlanner.plan(melody: melody, sourceSet: sourceSet)

        XCTAssertEqual(assignments.map(\.recordingID), ["low", "middle", "high", "low"])
        XCTAssertEqual(facts.usedRecordingIDs, ["high", "low", "middle"])
        XCTAssertEqual(facts.pitchedAssignmentCount, 4)
        XCTAssertEqual(facts.consecutiveSourceReuseCount, 0)
    }

    func testSourceSelectionHonorsIndividualChoiceAndLimitsRecommendationToFivePitchedSources() throws {
        let melody = CuratedMelody(
            id: "selection",
            title: "Selection",
            provenance: "Test fixture",
            bpm: 120,
            events: [MelodyEvent(60, 1)]
        )
        let pitched = (60...65).map { makeCandidate(id: "midi-\($0)", midiNote: Double($0)) }
        let unpitched = makeCandidate(id: "unpitched", midiNote: nil)

        let individual = try MelodyFitPlanner.sourceSet(
            mode: .chooseIndividual,
            melody: melody,
            candidates: pitched,
            individualID: "midi-65"
        )
        let recommended = try MelodyFitPlanner.sourceSet(
            mode: .recommendBestFit,
            melody: melody,
            candidates: pitched + [unpitched]
        )
        let fallback = try MelodyFitPlanner.sourceSet(
            mode: .recommendBestFit,
            melody: melody,
            candidates: [unpitched]
        )

        XCTAssertEqual(individual.candidates.map(\.id), ["midi-65"])
        XCTAssertEqual(recommended.candidates.map(\.id), ["midi-60", "midi-61", "midi-62", "midi-63", "midi-64"])
        XCTAssertEqual(fallback.candidates.map(\.id), ["unpitched"])
    }

    func testPlanTransposesByOctaveAndReportsLargeResamplingShifts() throws {
        let transposedMelody = CuratedMelody(
            id: "transpose",
            title: "Transpose",
            provenance: "Test fixture",
            bpm: 120,
            events: [MelodyEvent(60, 1)]
        )
        let transposedSourceSet = try MelodyFitPlanner.sourceSet(
            mode: .chooseIndividual,
            melody: transposedMelody,
            candidates: [makeCandidate(id: "octave-up", midiNote: 72)]
        )

        let (transposedAssignments, _) = try MelodyFitPlanner.plan(
            melody: transposedMelody,
            sourceSet: transposedSourceSet
        )

        XCTAssertEqual(transposedAssignments.map(\.targetMIDINote), [60])
        XCTAssertEqual(transposedAssignments.map(\.renderedMIDINote), [72])
        XCTAssertEqual(transposedAssignments.map(\.semitoneShift), [0])

        let shiftedMelody = CuratedMelody(
            id: "large-shift",
            title: "Large Shift",
            provenance: "Test fixture",
            bpm: 120,
            events: [MelodyEvent(60, 1), MelodyEvent(60, 1)]
        )
        let shiftedSourceSet = try MelodyFitPlanner.sourceSet(
            mode: .recommendBestFit,
            melody: shiftedMelody,
            candidates: [
                makeCandidate(id: "low", midiNote: 40),
                makeCandidate(id: "high", midiNote: 80),
            ]
        )

        let (shiftedAssignments, shiftedFacts) = try MelodyFitPlanner.plan(
            melody: shiftedMelody,
            sourceSet: shiftedSourceSet
        )

        XCTAssertEqual(shiftedAssignments.map(\.semitoneShift), [20, -20])
        XCTAssertEqual(shiftedFacts.meanAbsoluteSemitoneShift, 20)
        XCTAssertEqual(shiftedFacts.maximumAbsoluteSemitoneShift, 20)
        XCTAssertTrue(shiftedFacts.warnings.contains("At least one note requires more than one octave of resampling."))
    }
}
