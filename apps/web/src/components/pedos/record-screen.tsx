'use client'

import { useEffect } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { keepMicrophoneOpen } from '@/lib/audio/keep-microphone-open'
import { desktop } from '@/lib/desktop'
import { RecordButton } from './record-button'
import { type RecordProblem, useRecordFlow } from './record-flow-provider'

const problems: Record<
  Exclude<RecordProblem, 'nothingHeard'>,
  { title: string; message?: string }
> = {
  microphoneOff: {
    title: 'Microphone is off',
    message: "Farty needs the microphone to record. Allow it in your browser's site settings."
  },
  couldNotStart: { title: "Couldn't start recording" },
  interrupted: { title: 'Recording stopped', message: 'Nothing was saved.' }
}

export function RecordScreen() {
  const { problem, capture, startRecording, dismissProblem } = useRecordFlow()
  const alert = problem && problem !== 'nothingHeard' ? problem : null
  useEffect(() => {
    const computer = window.matchMedia(desktop)
    const follow = () => {
      if (!computer.matches) keepMicrophoneOpen()
    }
    follow()
    computer.addEventListener('change', follow)
    return () => computer.removeEventListener('change', follow)
  }, [])

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7">
      <div className="h-10" />
      <RecordButton
        isRecording={false}
        starting={capture.kind === 'starting'}
        disabled={capture.kind !== 'idle'}
        onClick={() => void startRecording()}
      />
      <p className="h-10 text-muted-foreground" data-testid="record-status">
        {problem === 'nothingHeard' && "Didn't catch that. Try again."}
      </p>

      <AlertDialog open={alert !== null} onOpenChange={open => !open && dismissProblem()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alert && problems[alert].title}</AlertDialogTitle>
            {alert && problems[alert].message && (
              <AlertDialogDescription>{problems[alert].message}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {alert !== 'microphoneOff' && (
              <AlertDialogAction onClick={() => void startRecording()}>Try again</AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
