#if !XINGSHU_ANDROID_PREVIEW
using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace XingShuRuntime.Utilities
{
    /// <summary>
    /// Windows-native companion audio decoder/player for CustomLobbyBackground.
    /// Uses Windows Media Foundation (MFCreateSourceReaderFromURL -> PCM16) + WinMM (waveOut)
    /// so custom lobby videos play audio reliably even when Unity's AudioManager has m_DisableAudio=true.
    /// Zero external dependencies, zero StructLayout marshaling, and compiled out on Android preview builds.
    /// </summary>
    internal sealed class WindowsLobbyAudioPlayer : IDisposable
    {
        private const uint MF_VERSION = 0x00020070;
        private const uint MFSTARTUP_NOSOCKET = 0x1;
        private const uint MF_SOURCE_READER_ALL_STREAMS = 0xFFFFFFFE;
        private const uint MF_SOURCE_READER_FIRST_AUDIO_STREAM = 0xFFFFFFFD;
        private const uint MF_SOURCE_READERF_ERROR = 0x00000001;
        private const uint MF_SOURCE_READERF_ENDOFSTREAM = 0x00000002;
        private const uint MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED = 0x00000020;

        private const uint WHDR_DONE = 0x00000001;
        private const uint WHDR_PREPARED = 0x00000002;
        private const int RingBufferCount = 4;
        private const int RingBufferCapacity = 65536;
        private const int WaveFormatExSize = 18;
        private const int PropVariantSize = 24;

        private static readonly int WaveHdrSize = IntPtr.Size == 8 ? 48 : 32;
        private static readonly int WaveHdrLengthOffset = IntPtr.Size == 8 ? 8 : 4;
        private static readonly int WaveHdrFlagsOffset = IntPtr.Size == 8 ? 24 : 16;

        private static readonly Guid MF_MT_MAJOR_TYPE = new Guid("48eba18e-f8c9-4687-bf11-0a74c9f96a8f");
        private static readonly Guid MF_MT_SUBTYPE = new Guid("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
        private static readonly Guid MFMediaType_Audio = new Guid("73647561-0000-0010-8000-00aa00389b71");
        private static readonly Guid MFAudioFormat_PCM = new Guid("00000001-0000-0010-8000-00aa00389b71");
        private static readonly Guid MF_MT_AUDIO_NUM_CHANNELS = new Guid("37e48bf5-645e-4c5b-89de-ada9e29b696a");
        private static readonly Guid MF_MT_AUDIO_SAMPLES_PER_SECOND = new Guid("5faeeae7-0290-4c31-9e8a-c534f68d9dba");
        private static readonly Guid MF_MT_AUDIO_BITS_PER_SAMPLE = new Guid("f2deb57f-40fa-4764-aa33-ed4f2d1ff669");

        [DllImport("mfplat.dll")]
        private static extern int MFStartup(uint version, uint dwFlags);

        [DllImport("mfplat.dll")]
        private static extern int MFShutdown();

        [DllImport("mfplat.dll")]
        private static extern int MFCreateMediaType(out IMFMediaType ppMFType);

        [DllImport("mfreadwrite.dll", CharSet = CharSet.Unicode)]
        private static extern int MFCreateSourceReaderFromURL(string pwszURL, IntPtr pAttributes, out IMFSourceReader ppSourceReader);

        [DllImport("winmm.dll")]
        private static extern int waveOutOpen(out IntPtr phwo, uint uDeviceID, IntPtr pwfx, IntPtr dwCallback, IntPtr dwInstance, uint fdwOpen);

        [DllImport("winmm.dll")]
        private static extern int waveOutPrepareHeader(IntPtr hwo, IntPtr pwh, uint cbwh);

        [DllImport("winmm.dll")]
        private static extern int waveOutUnprepareHeader(IntPtr hwo, IntPtr pwh, uint cbwh);

        [DllImport("winmm.dll")]
        private static extern int waveOutWrite(IntPtr hwo, IntPtr pwh, uint cbwh);

        [DllImport("winmm.dll")]
        private static extern int waveOutReset(IntPtr hwo);

        [DllImport("winmm.dll")]
        private static extern int waveOutClose(IntPtr hwo);

        [ComImport, Guid("44ae0fa8-ea31-4109-8d2e-4cae4997c555"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMFMediaType
        {
            void _0(); void _1(); void _2(); void _3();
            [PreserveSig] int GetUINT32([In] ref Guid guidKey, out uint punValue);
            void _5(); void _6(); void _7(); void _8(); void _9(); void _10(); void _11(); void _12(); void _13(); void _14();
            void _15(); void _16(); void _17();
            [PreserveSig] int SetUINT32([In] ref Guid guidKey, uint unValue);
            void _19(); void _20();
            [PreserveSig] int SetGUID([In] ref Guid guidKey, [In] ref Guid guidValue);
        }

        [ComImport, Guid("70ae66f2-c809-4e4f-8915-bdcb406b7993"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMFSourceReader
        {
            [PreserveSig] int GetStreamSelection(uint dwStreamIndex, [MarshalAs(UnmanagedType.Bool)] out bool pfSelected);
            [PreserveSig] int SetStreamSelection(uint dwStreamIndex, [MarshalAs(UnmanagedType.Bool)] bool fSelected);
            [PreserveSig] int GetNativeMediaType(uint dwStreamIndex, uint dwMediaTypeIndex, out IMFMediaType ppMediaType);
            [PreserveSig] int GetCurrentMediaType(uint dwStreamIndex, out IMFMediaType ppMediaType);
            [PreserveSig] int SetCurrentMediaType(uint dwStreamIndex, IntPtr pdwReserved, IMFMediaType pMediaType);
            [PreserveSig] int SetCurrentPosition([In] ref Guid guidTimeFormat, IntPtr varPosition);
            [PreserveSig] int ReadSample(uint dwStreamIndex, uint dwControlFlags, out uint pdwActualStreamIndex, out uint pdwStreamFlags, out long pllTimestamp, out IMFSample ppSample);
        }

        [ComImport, Guid("c40a00f2-b93a-4d80-ae8c-5a1c634f58e4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMFSample
        {
            void _0(); void _1(); void _2(); void _3(); void _4(); void _5(); void _6(); void _7(); void _8(); void _9();
            void _10(); void _11(); void _12(); void _13(); void _14(); void _15(); void _16(); void _17(); void _18(); void _19();
            void _20(); void _21(); void _22(); void _23(); void _24(); void _25(); void _26(); void _27(); void _28(); void _29();
            [PreserveSig] int GetSampleFlags(out uint pdwSampleFlags);
            [PreserveSig] int SetSampleFlags(uint dwSampleFlags);
            [PreserveSig] int GetSampleTime(out long phnsSampleTime);
            [PreserveSig] int SetSampleTime(long hnsSampleTime);
            [PreserveSig] int GetSampleDuration(out long phnsSampleDuration);
            [PreserveSig] int SetSampleDuration(long hnsSampleDuration);
            [PreserveSig] int GetBufferCount(out uint pdwBufferCount);
            [PreserveSig] int GetBufferByIndex(uint dwIndex, out IMFMediaBuffer ppBuffer);
            [PreserveSig] int ConvertToContiguousBuffer(out IMFMediaBuffer ppBuffer);
        }

        [ComImport, Guid("045FA593-8799-42b8-BC8D-8968C6453507"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMFMediaBuffer
        {
            [PreserveSig] int Lock(out IntPtr ppbBuffer, out uint pcbMaxLength, out uint pcbCurrentLength);
            [PreserveSig] int Unlock();
            [PreserveSig] int GetCurrentLength(out uint pcbCurrentLength);
        }

        private readonly object _lock = new object();
        private Thread _worker;
        private volatile bool _stopRequested;
        private volatile bool _paused;
        private volatile bool _muted = true;
        private volatile float _volume = CustomLobbyBgPolicy.DefaultVolume;
        private volatile float _speed = CustomLobbyBgPolicy.DefaultSpeed;
        private volatile bool _hasAudio;
        private double _currentTimeSeconds;
        private int _generation;

        private bool _seekPending;
        private double _seekTargetSeconds;
        private IntPtr _activeWaveOut = IntPtr.Zero;

        internal bool HasAudio => _hasAudio;

        internal double CurrentTimeSeconds
        {
            get
            {
                lock (_lock)
                {
                    return _currentTimeSeconds;
                }
            }
        }

        internal void StartFile(string fullPath, bool muted, float volume, float speed, bool paused, double startSeconds)
        {
            Stop();
            if (string.IsNullOrEmpty(fullPath))
            {
                return;
            }

            int gen;
            lock (_lock)
            {
                _stopRequested = false;
                _muted = muted;
                _volume = CustomLobbyBgPolicy.ClampVolume(volume);
                _speed = CustomLobbyBgPolicy.ClampSpeed(speed);
                _paused = paused;
                _hasAudio = false;
                _currentTimeSeconds = startSeconds > 0.0 ? startSeconds : 0.0;
                _seekPending = startSeconds > 0.05;
                _seekTargetSeconds = _currentTimeSeconds;
                gen = ++_generation;
            }

            Thread t = new Thread(() => WorkerMain(fullPath, gen))
            {
                IsBackground = true,
                Name = "XingShu_LobbyAudio"
            };
            try
            {
                t.SetApartmentState(ApartmentState.MTA);
            }
            catch
            {
            }
            _worker = t;
            t.Start();
        }

        internal void SetAudioParams(bool muted, float volume, float speed)
        {
            _muted = muted;
            _volume = CustomLobbyBgPolicy.ClampVolume(volume);
            _speed = CustomLobbyBgPolicy.ClampSpeed(speed);
        }

        internal void SetPaused(bool paused)
        {
            _paused = paused;
            if (paused)
            {
                IntPtr hwo;
                lock (_lock)
                {
                    hwo = _activeWaveOut;
                }
                if (hwo != IntPtr.Zero)
                {
                    try { waveOutReset(hwo); } catch { }
                }
            }
        }

        internal void RequestSeek(double seconds)
        {
            lock (_lock)
            {
                _seekTargetSeconds = seconds > 0.0 ? seconds : 0.0;
                _seekPending = true;
                _currentTimeSeconds = _seekTargetSeconds;
                IntPtr hwo = _activeWaveOut;
                if (hwo != IntPtr.Zero)
                {
                    try { waveOutReset(hwo); } catch { }
                }
            }
        }

        internal void Stop()
        {
            _stopRequested = true;
            IntPtr hwo;
            Thread t;
            lock (_lock)
            {
                _generation++;
                hwo = _activeWaveOut;
                t = _worker;
                _worker = null;
            }
            if (hwo != IntPtr.Zero)
            {
                try { waveOutReset(hwo); } catch { }
            }
            if (t != null && t.IsAlive && t != Thread.CurrentThread)
            {
                try { t.Join(400); } catch { }
            }
            _hasAudio = false;
        }

        public void Dispose()
        {
            Stop();
        }

        private void WorkerMain(string fullPath, int gen)
        {
            bool mfStarted = false;
            IMFSourceReader reader = null;
            IntPtr hwo = IntPtr.Zero;
            IntPtr propVarPtr = IntPtr.Zero;
            IntPtr[] hdrPtrs = new IntPtr[RingBufferCount];
            IntPtr[] dataPtrs = new IntPtr[RingBufferCount];
            bool[] inUse = new bool[RingBufferCount];

            try
            {
                if (MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) != 0)
                {
                    return;
                }
                mfStarted = true;

                if (MFCreateSourceReaderFromURL(fullPath, IntPtr.Zero, out reader) != 0 || reader == null)
                {
                    return;
                }

                reader.SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS, false);
                if (reader.SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, true) != 0)
                {
                    return;
                }

                if (!ConfigurePcm16Output(reader, out uint channels, out uint sampleRate))
                {
                    return;
                }

                if (!OpenWaveOut(channels, sampleRate, out hwo))
                {
                    return;
                }

                propVarPtr = AllocZeroed(PropVariantSize);
                for (int i = 0; i < RingBufferCount; i++)
                {
                    dataPtrs[i] = Marshal.AllocHGlobal(RingBufferCapacity);
                    hdrPtrs[i] = AllocZeroed(WaveHdrSize);
                    WriteWaveHdr(hdrPtrs[i], dataPtrs[i], (uint)RingBufferCapacity);
                }

                lock (_lock)
                {
                    if (_stopRequested || _generation != gen)
                    {
                        return;
                    }
                    _activeWaveOut = hwo;
                }
                _hasAudio = true;

                byte[] srcBuf = new byte[RingBufferCapacity];
                byte[] dstBuf = new byte[RingBufferCapacity];
                float prevGain = _muted ? 0f : _volume;
                double fracPos = 0.0;
                bool wasPaused = _paused;
                int cursor = 0;

                while (!_stopRequested && _generation == gen)
                {
                    bool pausedNow = _paused;
                    if (pausedNow)
                    {
                        if (!wasPaused)
                        {
                            try { waveOutReset(hwo); } catch { }
                            ReclaimFinishedOrResetBuffers(hwo, hdrPtrs, inUse);
                            prevGain = 0f;
                        }
                        wasPaused = true;
                        Thread.Sleep(25);
                        continue;
                    }

                    if (wasPaused)
                    {
                        wasPaused = false;
                        prevGain = 0f; // soft fade-in after resume
                    }

                    double? seekTo = null;
                    lock (_lock)
                    {
                        if (_seekPending)
                        {
                            _seekPending = false;
                            seekTo = _seekTargetSeconds;
                        }
                    }
                    if (seekTo.HasValue)
                    {
                        try { waveOutReset(hwo); } catch { }
                        ReclaimFinishedOrResetBuffers(hwo, hdrPtrs, inUse);
                        SeekReader(reader, propVarPtr, seekTo.Value);
                        fracPos = 0.0;
                        prevGain = 0f;
                    }

                    ReclaimFinishedOrResetBuffers(hwo, hdrPtrs, inUse);

                    int slot = FindFreeSlot(inUse, ref cursor);
                    if (slot < 0)
                    {
                        Thread.Sleep(8);
                        continue;
                    }

                    uint actualIdx, streamFlags;
                    long timestamp100Ns;
                    IMFSample sample;
                    int hrRead = reader.ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, out actualIdx, out streamFlags, out timestamp100Ns, out sample);
                    if (hrRead != 0 || (streamFlags & MF_SOURCE_READERF_ERROR) != 0)
                    {
                        if (sample != null) Marshal.ReleaseComObject(sample);
                        break;
                    }

                    if ((streamFlags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED) != 0)
                    {
                        if (ConfigurePcm16Output(reader, out uint newCh, out uint newSr) && (newCh != channels || newSr != sampleRate))
                        {
                            CloseWaveOut(hwo, hdrPtrs, inUse);
                            channels = newCh;
                            sampleRate = newSr;
                            if (!OpenWaveOut(channels, sampleRate, out hwo))
                            {
                                if (sample != null) Marshal.ReleaseComObject(sample);
                                break;
                            }
                            lock (_lock) { _activeWaveOut = hwo; }
                            fracPos = 0.0;
                        }
                    }

                    if ((streamFlags & MF_SOURCE_READERF_ENDOFSTREAM) != 0 && sample == null)
                    {
                        SeekReader(reader, propVarPtr, 0.0);
                        fracPos = 0.0;
                        continue;
                    }

                    if (sample == null)
                    {
                        Thread.Sleep(5);
                        continue;
                    }

                    try
                    {
                        lock (_lock)
                        {
                            _currentTimeSeconds = timestamp100Ns / 10000000.0;
                        }

                        IMFMediaBuffer mediaBuf = null;
                        try
                        {
                            if (sample.ConvertToContiguousBuffer(out mediaBuf) != 0 || mediaBuf == null)
                            {
                                continue;
                            }
                            IntPtr rawPtr;
                            uint maxLen, curLen;
                            if (mediaBuf.Lock(out rawPtr, out maxLen, out curLen) != 0)
                            {
                                continue;
                            }
                            try
                            {
                                int len = (int)curLen;
                                if (len <= 0) continue;
                                if (len > srcBuf.Length)
                                {
                                    srcBuf = new byte[len];
                                }
                                Marshal.Copy(rawPtr, srcBuf, 0, len);

                                float targetGain = _muted ? 0f : _volume;
                                CustomLobbyBgPolicy.ProcessPcm16Chunk(
                                    srcBuf, len, (int)channels, _speed, prevGain, targetGain,
                                    ref fracPos, dstBuf, out int dstBytes);
                                prevGain = targetGain;

                                if (dstBytes > 0)
                                {
                                    if (dstBytes > RingBufferCapacity) dstBytes = RingBufferCapacity;
                                    Marshal.Copy(dstBuf, 0, dataPtrs[slot], dstBytes);
                                    WriteWaveHdr(hdrPtrs[slot], dataPtrs[slot], (uint)dstBytes);
                                    if (waveOutPrepareHeader(hwo, hdrPtrs[slot], (uint)WaveHdrSize) == 0)
                                    {
                                        if (waveOutWrite(hwo, hdrPtrs[slot], (uint)WaveHdrSize) == 0)
                                        {
                                            inUse[slot] = true;
                                        }
                                        else
                                        {
                                            waveOutUnprepareHeader(hwo, hdrPtrs[slot], (uint)WaveHdrSize);
                                        }
                                    }
                                }
                            }
                            finally
                            {
                                mediaBuf.Unlock();
                            }
                        }
                        finally
                        {
                            if (mediaBuf != null) Marshal.ReleaseComObject(mediaBuf);
                        }
                    }
                    finally
                    {
                        Marshal.ReleaseComObject(sample);
                    }

                    if ((streamFlags & MF_SOURCE_READERF_ENDOFSTREAM) != 0)
                    {
                        SeekReader(reader, propVarPtr, 0.0);
                        fracPos = 0.0;
                    }
                }
            }
            catch
            {
            }
            finally
            {
                _hasAudio = false;
                lock (_lock)
                {
                    if (_activeWaveOut == hwo)
                    {
                        _activeWaveOut = IntPtr.Zero;
                    }
                }
                if (hwo != IntPtr.Zero)
                {
                    CloseWaveOut(hwo, hdrPtrs, inUse);
                }
                if (propVarPtr != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(propVarPtr);
                }
                for (int i = 0; i < RingBufferCount; i++)
                {
                    if (hdrPtrs[i] != IntPtr.Zero) { Marshal.FreeHGlobal(hdrPtrs[i]); hdrPtrs[i] = IntPtr.Zero; }
                    if (dataPtrs[i] != IntPtr.Zero) { Marshal.FreeHGlobal(dataPtrs[i]); dataPtrs[i] = IntPtr.Zero; }
                }
                if (reader != null)
                {
                    try { Marshal.ReleaseComObject(reader); } catch { }
                }
                if (mfStarted)
                {
                    try { MFShutdown(); } catch { }
                }
            }
        }

        private static bool ConfigurePcm16Output(IMFSourceReader reader, out uint channels, out uint sampleRate)
        {
            channels = 0;
            sampleRate = 0;
            IMFMediaType req = null;
            IMFMediaType actual = null;
            try
            {
                if (MFCreateMediaType(out req) != 0 || req == null) return false;
                Guid gMajor = MF_MT_MAJOR_TYPE, gAudio = MFMediaType_Audio;
                Guid gSub = MF_MT_SUBTYPE, gPcm = MFAudioFormat_PCM;
                Guid gBits = MF_MT_AUDIO_BITS_PER_SAMPLE;
                req.SetGUID(ref gMajor, ref gAudio);
                req.SetGUID(ref gSub, ref gPcm);
                req.SetUINT32(ref gBits, 16);

                if (reader.SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, IntPtr.Zero, req) != 0)
                {
                    return false;
                }
                if (reader.GetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, out actual) != 0 || actual == null)
                {
                    return false;
                }

                Guid gCh = MF_MT_AUDIO_NUM_CHANNELS, gSr = MF_MT_AUDIO_SAMPLES_PER_SECOND;
                actual.GetUINT32(ref gCh, out channels);
                actual.GetUINT32(ref gSr, out sampleRate);
                if (channels > 2)
                {
                    Marshal.ReleaseComObject(actual);
                    actual = null;
                    req.SetUINT32(ref gCh, 2);
                    if (reader.SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, IntPtr.Zero, req) == 0
                        && reader.GetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, out actual) == 0
                        && actual != null)
                    {
                        actual.GetUINT32(ref gCh, out channels);
                        actual.GetUINT32(ref gSr, out sampleRate);
                    }
                }
                return channels >= 1 && channels <= 2 && sampleRate >= 8000;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (actual != null) try { Marshal.ReleaseComObject(actual); } catch { }
                if (req != null) try { Marshal.ReleaseComObject(req); } catch { }
            }
        }

        private static bool OpenWaveOut(uint channels, uint sampleRate, out IntPtr hwo)
        {
            hwo = IntPtr.Zero;
            IntPtr wfxPtr = IntPtr.Zero;
            try
            {
                wfxPtr = AllocZeroed(WaveFormatExSize);
                ushort blockAlign = (ushort)(channels * 2);
                uint avgBytesPerSec = sampleRate * blockAlign;
                Marshal.WriteInt16(wfxPtr, 0, 1);                      // wFormatTag = WAVE_FORMAT_PCM
                Marshal.WriteInt16(wfxPtr, 2, (short)channels);        // nChannels
                Marshal.WriteInt32(wfxPtr, 4, (int)sampleRate);        // nSamplesPerSec
                Marshal.WriteInt32(wfxPtr, 8, (int)avgBytesPerSec);    // nAvgBytesPerSec
                Marshal.WriteInt16(wfxPtr, 12, (short)blockAlign);     // nBlockAlign
                Marshal.WriteInt16(wfxPtr, 14, 16);                    // wBitsPerSample
                Marshal.WriteInt16(wfxPtr, 16, 0);                     // cbSize
                return waveOutOpen(out hwo, 0xFFFFFFFFu, wfxPtr, IntPtr.Zero, IntPtr.Zero, 0) == 0 && hwo != IntPtr.Zero;
            }
            finally
            {
                if (wfxPtr != IntPtr.Zero) Marshal.FreeHGlobal(wfxPtr);
            }
        }

        private static IntPtr AllocZeroed(int size)
        {
            IntPtr ptr = Marshal.AllocHGlobal(size);
            byte[] zeros = new byte[size];
            Marshal.Copy(zeros, 0, ptr, size);
            return ptr;
        }

        private static void WriteWaveHdr(IntPtr hdrPtr, IntPtr dataPtr, uint length)
        {
            byte[] zeros = new byte[WaveHdrSize];
            Marshal.Copy(zeros, 0, hdrPtr, WaveHdrSize);
            Marshal.WriteIntPtr(hdrPtr, 0, dataPtr);
            Marshal.WriteInt32(hdrPtr, WaveHdrLengthOffset, (int)length);
        }

        private static void ReclaimFinishedOrResetBuffers(IntPtr hwo, IntPtr[] hdrPtrs, bool[] inUse)
        {
            for (int i = 0; i < RingBufferCount; i++)
            {
                if (!inUse[i] || hdrPtrs[i] == IntPtr.Zero) continue;
                uint flags = (uint)Marshal.ReadInt32(hdrPtrs[i], WaveHdrFlagsOffset);
                if ((flags & WHDR_DONE) != 0 || (flags & WHDR_PREPARED) == 0)
                {
                    try { waveOutUnprepareHeader(hwo, hdrPtrs[i], (uint)WaveHdrSize); } catch { }
                    inUse[i] = false;
                }
            }
        }

        private static int FindFreeSlot(bool[] inUse, ref int cursor)
        {
            for (int offset = 0; offset < RingBufferCount; offset++)
            {
                int idx = (cursor + offset) % RingBufferCount;
                if (!inUse[idx])
                {
                    cursor = (idx + 1) % RingBufferCount;
                    return idx;
                }
            }
            return -1;
        }

        private static void SeekReader(IMFSourceReader reader, IntPtr propVarPtr, double seconds)
        {
            try
            {
                byte[] zeros = new byte[PropVariantSize];
                Marshal.Copy(zeros, 0, propVarPtr, PropVariantSize);
                Marshal.WriteInt16(propVarPtr, 0, 20); // VT_I8
                long hns = seconds > 0.0 ? (long)(seconds * 10000000.0) : 0L;
                Marshal.WriteInt64(propVarPtr, 8, hns);
                Guid guidNull = Guid.Empty;
                reader.SetCurrentPosition(ref guidNull, propVarPtr);
            }
            catch
            {
            }
        }

        private static void CloseWaveOut(IntPtr hwo, IntPtr[] hdrPtrs, bool[] inUse)
        {
            try { waveOutReset(hwo); } catch { }
            for (int i = 0; i < RingBufferCount; i++)
            {
                if (inUse[i] && hdrPtrs[i] != IntPtr.Zero)
                {
                    try { waveOutUnprepareHeader(hwo, hdrPtrs[i], (uint)WaveHdrSize); } catch { }
                    inUse[i] = false;
                }
            }
            try { waveOutClose(hwo); } catch { }
        }
    }
}
#endif
