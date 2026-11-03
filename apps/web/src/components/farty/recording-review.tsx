'use client'

import { useEffect, useState } from 'react'
import { stopPlayback } from '@/lib/audio/player'
import { type Recording, recordingName } from '@/lib/recordings'
import { usePlayback } from './playback-provider'
import { Cover, FlowButton, FlowButtons } from './record-cover'
import { useRecordFlow } from './record-flow-provider'
import { useTake } from './recording-replay'
import { useRecordings } from './recordings-provider'
import { TakeReview, useTakeReview } from './take-review'

export function RecordingReview({
  recording,
  onClose
}: {
  recording: Recording
  onClose: () => void
}) {
  const { setReviewOpen } = useRecordFlow()
  const { nowPlaying } = usePlayback()
  const { placeRecording } = useRecordings()
  const review = useTakeReview(recording)
  const audio = useTake(recording)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setReviewOpen(true)
    return () => setReviewOpen(false)
  }, [setReviewOpen])
  const close = () => {
    if (nowPlaying === recording.id) stopPlayback()
    onClose()
  }
  const save = async () => {
    const change = review.change()
    if (change.handles === undefined) {
      if (Object.keys(change).length > 0) void placeRecording(recording.id, change)
      close()
      return
    }
    setSaving(true)
    setFailed(false)
    const saved = await placeRecording(recording.id, change)
    setSaving(false)
    if (saved) close()
    else setFailed(true)
  }
  return (
    <Cover title={recordingName({ number: recording.number, name: review.name })} onClose={close}>
      <TakeReview review={review} target={recording} audio={audio} />
      {failed && (
        <p role="alert" className="px-5 pb-2 text-sm text-destructive">
          Couldn't save the trim. Try again.
        </p>
      )}
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={close}>
            Cancel
          </FlowButton>
        }
        primary={
          <FlowButton variant="primary" disabled={saving} onClick={() => void save()}>
            Save
          </FlowButton>
        }
      />
    </Cover>
  )
}
