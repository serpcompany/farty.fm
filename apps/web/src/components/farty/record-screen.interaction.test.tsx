import { afterEach, describe, expect, it, vi } from 'vitest'
import { button, closeScreens, dialogs, show, tap } from '@/test-support/screen'
import { type RecordProblem, useRecordFlow } from './record-flow-provider'
import { RecordScreen } from './record-screen'

vi.mock('@/lib/audio/keep-microphone-open', () => ({ keepMicrophoneOpen: vi.fn() }))
vi.mock('./record-flow-provider', () => ({ useRecordFlow: vi.fn() }))

const startRecording = vi.fn()
const dismissProblem = vi.fn()

function showProblem(problem: RecordProblem) {
  vi.mocked(useRecordFlow).mockReturnValue({
    problem,
    capture: { kind: 'idle' },
    startRecording,
    dismissProblem
  } as unknown as ReturnType<typeof useRecordFlow>)
  return show(<RecordScreen />)
}

const alertButtons = () =>
  [...(dialogs()[0]?.querySelectorAll('button') ?? [])].map(each => each.textContent)

afterEach(() => {
  closeScreens()
  vi.clearAllMocks()
})

describe('the Record tab', () => {
  it.each([
    [
      'microphoneOff',
      "Microphone is offFarty needs the microphone to record. Allow it in your browser's site settings.",
      ['Cancel']
    ],
    ['couldNotStart', "Couldn't start recording", ['Cancel', 'Try again']],
    ['interrupted', 'Recording stoppedNothing was saved.', ['Cancel', 'Try again']]
  ] as const)('says in words what went wrong (%s), with its buttons', async (problem, words, actions) => {
    await showProblem(problem)

    expect(dialogs().map(dialog => dialog.textContent)).toEqual([words + actions.join('')])
    expect(alertButtons()).toEqual(actions)
    await tap(button(actions[actions.length - 1]))
    expect(actions.length === 1 ? dismissProblem : startRecording).toHaveBeenCalledOnce()
  })
})
