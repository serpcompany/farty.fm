declare module "wav-decoder" {
  interface AudioData {
    sampleRate: number;
    channelData: Float32Array[];
    length: number;
    numberOfChannels: number;
  }

  interface DecodeOptions {
    symmetric?: boolean;
  }

  function decode(buffer: Buffer | ArrayBuffer, opts?: DecodeOptions): Promise<AudioData>;
  function decodeSync(buffer: Buffer | ArrayBuffer, opts?: DecodeOptions): AudioData;
}
