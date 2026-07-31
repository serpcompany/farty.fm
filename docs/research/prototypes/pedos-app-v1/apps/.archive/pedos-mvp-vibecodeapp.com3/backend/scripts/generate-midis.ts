import { Midi } from "@tonejs/midi";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = join(__dirname, "../../test-data/melodies");
mkdirSync(OUTPUT_DIR, { recursive: true });

// Helper: convert note name to MIDI number
function noteToMidi(note: string): number {
  const noteMap: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  };
  const match = note.match(/^([A-G])([#b]?)(\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const letter = match[1] as string;
  const accidental = match[2] as string;
  const octaveStr = match[3] as string;
  let semitone = noteMap[letter]!;
  if (accidental === "#") semitone += 1;
  if (accidental === "b") semitone -= 1;
  return (parseInt(octaveStr) + 1) * 12 + semitone;
}

interface NoteEntry {
  note: string;
  /** duration as a multiplier of quarter note duration */
  dur: number;
}

function q(note: string): NoteEntry {
  return { note, dur: 1 };
}
function h(note: string): NoteEntry {
  return { note, dur: 2 };
}
function w(note: string): NoteEntry {
  return { note, dur: 4 };
}
function e(note: string): NoteEntry {
  return { note, dur: 0.5 };
}
function dq(note: string): NoteEntry {
  return { note, dur: 1.5 };
}

function generateMidi(
  filename: string,
  bpm: number,
  timeSignature: [number, number],
  notes: NoteEntry[]
): void {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: timeSignature,
    measures: 0,
  });

  const track = midi.addTrack();
  const quarterDuration = 60 / bpm; // seconds per quarter note

  let currentTime = 0;
  for (const { note, dur } of notes) {
    const duration = dur * quarterDuration;
    track.addNote({
      midi: noteToMidi(note),
      time: currentTime,
      duration,
      velocity: 0.8,
    });
    currentTime += duration;
  }

  const outputPath = join(OUTPUT_DIR, filename);
  writeFileSync(outputPath, Buffer.from(midi.toArray()));
  console.log(`Generated: ${outputPath} (${Math.round(currentTime)}s, ${notes.length} notes)`);
}

// 1. Twinkle Twinkle Little Star - BPM 120, 4/4
generateMidi("twinkle.mid", 120, [4, 4], [
  q("C4"), q("C4"), q("G4"), q("G4"), q("A4"), q("A4"), h("G4"),
  q("F4"), q("F4"), q("E4"), q("E4"), q("D4"), q("D4"), h("C4"),
]);

// 2. Happy Birthday - BPM 140, 3/4
generateMidi("happy-birthday.mid", 140, [3, 4], [
  e("G3"), e("G3"), q("A3"), q("G3"), q("C4"), h("B3"),
  e("G3"), e("G3"), q("A3"), q("G3"), q("D4"), h("C4"),
  e("G3"), e("G3"), q("G4"), q("E4"), q("C4"), q("B3"), q("A3"),
  e("F4"), e("F4"), q("E4"), q("C4"), q("D4"), h("C4"),
]);

// 3. Mary Had a Little Lamb - BPM 120, 4/4
generateMidi("mary-lamb.mid", 120, [4, 4], [
  q("E4"), q("D4"), q("C4"), q("D4"),
  q("E4"), q("E4"), h("E4"),
  q("D4"), q("D4"), h("D4"),
  q("E4"), q("G4"), h("G4"),
  q("E4"), q("D4"), q("C4"), q("D4"),
  q("E4"), q("E4"), q("E4"), q("E4"),
  q("D4"), q("D4"), q("E4"), q("D4"),
  w("C4"),
]);

// 4. Ode to Joy - BPM 120, 4/4
generateMidi("ode-to-joy.mid", 120, [4, 4], [
  q("E4"), q("E4"), q("F4"), q("G4"),
  q("G4"), q("F4"), q("E4"), q("D4"),
  q("C4"), q("C4"), q("D4"), q("E4"),
  dq("E4"), e("D4"), h("D4"),
  q("E4"), q("E4"), q("F4"), q("G4"),
  q("G4"), q("F4"), q("E4"), q("D4"),
  q("C4"), q("C4"), q("D4"), q("E4"),
  dq("D4"), e("C4"), h("C4"),
]);

// 5. Jingle Bells (Chorus) - BPM 160, 4/4
generateMidi("jingle-bells.mid", 160, [4, 4], [
  // Line 1
  q("E4"), q("E4"), h("E4"),
  q("E4"), q("E4"), h("E4"),
  q("E4"), q("G4"), q("C4"), q("D4"),
  w("E4"),
  // Line 2
  q("F4"), q("F4"), q("F4"), q("F4"),
  q("F4"), q("E4"), q("E4"), e("E4"), e("E4"),
  q("E4"), q("D4"), q("D4"), q("E4"),
  h("D4"), h("G4"),
  // Line 3
  q("E4"), q("E4"), h("E4"),
  q("E4"), q("E4"), h("E4"),
  q("E4"), q("G4"), q("C4"), q("D4"),
  w("E4"),
  // Line 4
  q("F4"), q("F4"), q("F4"), q("F4"),
  q("F4"), q("E4"), q("E4"), e("E4"), e("E4"),
  q("G4"), q("G4"), q("F4"), q("D4"),
  w("C4"),
]);

// 6. Row Row Row Your Boat - BPM 120, 3/4
generateMidi("row-your-boat.mid", 120, [3, 4], [
  dq("C4"), dq("C4"),
  dq("C4"), q("D4"), e("E4"),
  dq("E4"), q("D4"), e("E4"),
  q("F4"), e("E4"), dq("G4"),
  e("C5"), e("C5"), e("C5"), e("G4"), e("G4"), e("G4"),
  e("E4"), e("E4"), e("E4"), e("C4"), e("C4"), e("C4"),
  dq("G4"), q("F4"), e("E4"),
  q("D4"), e("C4"), dq("C4"),
]);

// 7. London Bridge - BPM 120, 4/4
generateMidi("london-bridge.mid", 120, [4, 4], [
  dq("G4"), e("A4"), q("G4"), q("F4"),
  q("E4"), q("F4"), h("G4"),
  q("D4"), q("E4"), h("F4"),
  q("E4"), q("F4"), h("G4"),
  dq("G4"), e("A4"), q("G4"), q("F4"),
  q("E4"), q("F4"), h("G4"),
  q("D4"), h("G4"), q("E4"),
  w("C4"),
]);

// 8. Hot Cross Buns - BPM 110, 4/4
generateMidi("hot-cross-buns.mid", 110, [4, 4], [
  q("E4"), q("D4"), h("C4"),
  q("E4"), q("D4"), h("C4"),
  e("C4"), e("C4"), e("C4"), e("C4"), e("D4"), e("D4"), e("D4"), e("D4"),
  q("E4"), q("D4"), h("C4"),
]);

// 9. Frère Jacques (Are You Sleeping) - BPM 120, 4/4
generateMidi("frere-jacques.mid", 120, [4, 4], [
  q("C4"), q("D4"), q("E4"), q("C4"),
  q("C4"), q("D4"), q("E4"), q("C4"),
  q("E4"), q("F4"), h("G4"),
  q("E4"), q("F4"), h("G4"),
  e("G4"), e("A4"), e("G4"), e("F4"), q("E4"), q("C4"),
  e("G4"), e("A4"), e("G4"), e("F4"), q("E4"), q("C4"),
  q("C4"), q("G3"), h("C4"),
  q("C4"), q("G3"), h("C4"),
]);

// 10. Yankee Doodle - BPM 130, 4/4
generateMidi("yankee-doodle.mid", 130, [4, 4], [
  q("C4"), q("C4"), q("D4"), q("E4"),
  q("C4"), q("E4"), q("D4"), q("G3"),
  q("C4"), q("C4"), q("D4"), q("E4"),
  h("C4"), h("B3"),
  q("C4"), q("C4"), q("D4"), q("E4"),
  q("F4"), q("E4"), q("D4"), q("C4"),
  q("B3"), q("G3"), q("A3"), q("B3"),
  h("C4"), h("C4"),
]);

// 11. When the Saints Go Marching In - BPM 120, 4/4
generateMidi("when-the-saints.mid", 120, [4, 4], [
  q("C4"), q("E4"), q("F4"), w("G4"),
  q("C4"), q("E4"), q("F4"), w("G4"),
  q("C4"), q("E4"), q("F4"), h("G4"),
  h("E4"), h("C4"), h("E4"), h("D4"),
  h("E4"), h("E4"), h("D4"), h("C4"),
  h("C4"), h("E4"), h("G4"), h("G4"),
  h("F4"), w("F4"), h("E4"),
  h("F4"), h("G4"), h("E4"), h("C4"),
  h("D4"), w("C4"),
]);

// 12. Amazing Grace (first verse) - BPM 90, 3/4
generateMidi("amazing-grace.mid", 90, [3, 4], [
  q("G3"), h("B3"), e("B3"), e("G3"),
  h("B3"), q("A3"),
  h("G3"), q("E3"),
  h("D3"), q("G3"),
  h("B3"), e("B3"), e("G3"),
  h("B3"), q("A3"),
  h("D4"), q("D4"),
  h("B3"), q("D4"),
  h("B3"), e("B3"), e("G3"),
  h("B3"), q("A3"),
  h("G3"), q("E3"),
  h("D3"), q("G3"),
  h("B3"), e("A3"), e("G3"),
  h("G3"),
]);

// 13. Oh! Susanna - BPM 130, 4/4
generateMidi("oh-susanna.mid", 130, [4, 4], [
  e("C4"), e("D4"), q("E4"), q("G4"), q("G4"), e("A4"), e("G4"),
  q("E4"), q("C4"), e("C4"), e("D4"), q("E4"), q("E4"), q("D4"), q("C4"), q("D4"),
  e("C4"), e("D4"), q("E4"), q("G4"), q("G4"), e("A4"), e("G4"),
  q("E4"), q("C4"), e("C4"), e("D4"), q("E4"), q("D4"), q("C4"), h("C4"),
]);

// 14. This Old Man - BPM 120, 4/4
generateMidi("this-old-man.mid", 120, [4, 4], [
  q("G4"), q("E4"), q("G4"), q("G4"), q("E4"), q("G4"),
  q("A4"), q("G4"), q("F4"), q("E4"), q("D4"), q("E4"), q("F4"),
  q("E4"), q("F4"), q("G4"), q("C4"), q("C4"),
  q("D4"), q("E4"), q("F4"), q("G4"),
  q("E4"), q("C4"), q("D4"), h("C4"),
]);

// 15. Auld Lang Syne - BPM 100, 4/4
generateMidi("auld-lang-syne.mid", 100, [4, 4], [
  q("G3"), dq("C4"), e("C4"), q("C4"), q("E4"),
  dq("D4"), e("C4"), q("D4"), e("E4"), e("D4"),
  dq("C4"), e("C4"), q("E4"), q("G4"),
  h("A4"), dq("A4"), q("G4"),
  dq("E4"), e("E4"), q("C4"), q("E4"),
  dq("D4"), e("C4"), q("D4"), e("E4"), e("D4"),
  dq("C4"), e("A3"), q("A3"), q("G3"),
  h("C4"), h("C4"),
]);

// 16. Greensleeves (first section) - BPM 110, 3/4
generateMidi("greensleeves.mid", 110, [3, 4], [
  q("A3"), h("C4"), q("D4"),
  dq("E4"), e("F4"), q("E4"),
  h("D4"), q("B3"),
  dq("G3"), e("A3"), q("B3"),
  h("C4"), q("A3"),
  dq("A3"), e("G#3"), q("A3"),
  h("B3"), q("G#3"),
  h("A3"), q("A3"),
]);

// 17. Camptown Races - BPM 140, 4/4
generateMidi("camptown-races.mid", 140, [4, 4], [
  q("G4"), q("G4"), q("E4"), q("G4"),
  q("A4"), q("G4"), h("E4"),
  q("E4"), q("D4"), h("D4"),
  q("G4"), q("B4"), h("B4"),
  q("G4"), q("G4"), q("E4"), q("G4"),
  q("A4"), q("G4"), q("E4"), q("E4"),
  q("D4"), q("D4"), q("E4"), q("D4"),
  w("C4"),
]);

// 18. Old MacDonald Had a Farm - BPM 120, 4/4
generateMidi("old-macdonald.mid", 120, [4, 4], [
  q("G4"), q("G4"), q("G4"), q("D4"),
  q("E4"), q("E4"), h("D4"),
  q("B4"), q("B4"), q("A4"), q("A4"),
  w("G4"),
  q("D4"), q("G4"), q("G4"), q("G4"),
  q("D4"), q("D4"), q("G4"), q("G4"), q("G4"),
  q("G4"), q("G4"), q("G4"), q("G4"),
  q("G4"), q("G4"), q("G4"), q("G4"),
  q("G4"), q("G4"), q("G4"), q("D4"),
  q("E4"), q("E4"), h("D4"),
  q("B4"), q("B4"), q("A4"), q("A4"),
  w("G4"),
]);

// 19. Fur Elise (main theme) - BPM 125, 3/8
generateMidi("fur-elise.mid", 125, [3, 8], [
  e("E5"), e("D#5"), e("E5"), e("D#5"), e("E5"),
  e("B4"), e("D5"), e("C5"), q("A4"),
  e("C4"), e("E4"), e("A4"), q("B4"),
  e("E4"), e("G#4"), e("B4"), q("C5"),
  e("E4"), e("E5"), e("D#5"), e("E5"), e("D#5"), e("E5"),
  e("B4"), e("D5"), e("C5"), q("A4"),
  e("C4"), e("E4"), e("A4"), q("B4"),
  e("E4"), e("C5"), e("B4"), q("A4"),
]);

// 20. La Cucaracha (main hook) - BPM 150, 4/4
generateMidi("la-cucaracha.mid", 150, [4, 4], [
  e("C4"), e("C4"), e("C4"), q("F4"), q("A4"),
  e("C4"), e("C4"), e("C4"), q("F4"), q("A4"),
  q("F4"), q("F4"), q("E4"), q("E4"),
  q("D4"), q("D4"), h("C4"),
  e("C4"), e("C4"), e("C4"), q("E4"), q("G4"),
  e("C4"), e("C4"), e("C4"), q("E4"), q("G4"),
  q("E4"), q("E4"), q("D4"), q("D4"),
  q("C4"), q("E4"), h("F4"),
]);

console.log("\nAll MIDI files generated successfully!");
