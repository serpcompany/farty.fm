'use client'

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
import { type RecordProblem, usePedos } from './pedos-provider'
import { RecordButton } from './record-button'

const problems: Record<
  Exclude<RecordProblem, 'nothingHeard'>,
  { title: string; message?: string }
> = {
  microphoneOff: {
    title: 'Microphone is off',
    message: "Pedos needs the microphone to record. Allow it in your browser's site settings."
  },
  couldNotStart: { title: "Couldn't start recording" },
  interrupted: { title: 'Recording stopped', message: 'Nothing was saved.' }
}

/** The Record tab: one big red button. Matches the iPhone app's `RecordTab`. */
export function RecordScreen() {
  const pedos = usePedos()
  const alert = pedos.problem && pedos.problem !== 'nothingHeard' ? pedos.problem : null

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7">
      {/* Balances the status line below, so the button stays centered. */}
      <div className="h-10" />
      <RecordButton
        isRecording={false}
        disabled={pedos.capture.kind !== 'idle'}
        onClick={() => void pedos.startRecording()}
      />
      <p className="h-10 text-muted-foreground" data-testid="record-status">
        {pedos.problem === 'nothingHeard' && "Didn't catch that. Try again."}
      </p>

      <AlertDialog open={alert !== null} onOpenChange={open => !open && pedos.dismissProblem()}>
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
              <AlertDialogAction onClick={() => void pedos.startRecording()}>
                Try again
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
