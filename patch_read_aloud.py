import re

with open(r'c:\Cursor AI\public\read-aloud-mode.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace constructor init
code = re.sub(
    r"    // Speech recognition state.*?    this\.bindEvents\(\);\n  }",
    """    // Speech recognition state
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.audioStream = null;

    this.bindEvents();
  }""",
    code, flags=re.DOTALL
)

# Replace cleanup through startRecording
code = re.sub(
    r"  cleanup\(\) \{.*?// Browser may reject duplicate start attempts\.\n      }\n    }\n  }",
    """  cleanup() {
    this.cancelPendingHydration();
    this.stopTimer();
    if (this.state === 'RECORDING' && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.stopMediaStream();

    const audioEl = document.getElementById('ra-elevenlabs-audio');
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    const playBtn = document.getElementById('ra-play-audio-btn');
    if (playBtn) playBtn.textContent = 'Play';

    this.state = 'IDLE';
  }

  stopMediaStream() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
  }

  isSupported() {
    return navigator.mediaDevices && typeof window.MediaRecorder === 'function';
  }

  applyUnsupportedState() {
    const statusMsg = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');

    if (statusMsg) statusMsg.textContent = 'Microphone recording is not supported in this browser. Please use Chrome or Edge.';
    if (recordBtn) {
      recordBtn.textContent = 'Unsupported Browser';
      recordBtn.disabled = true;
    }
    if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
    if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
  }

  updateUIForState() {
    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');
    const recordBtn = document.getElementById('ra-record-btn');
    const statusMsg = document.getElementById('ra-status-message');
    const resultBox = document.getElementById('ra-result-box');
    const stopBtn = document.getElementById('ra-stop-btn');

    if (this.state === 'PREP') {
      if (prepTimerBox) prepTimerBox.style.opacity = '1';
      if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
      if (recordBtn) {
        recordBtn.textContent = 'Skip Prep';
        recordBtn.disabled = false;
        recordBtn.style.display = '';
      }
      if (statusMsg) statusMsg.textContent = 'Read the text silently to prepare.';
      if (resultBox) resultBox.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
      this.updateTimerDisplay('ra-prep-time', this.prepSeconds);
      this.updateTimerDisplay('ra-record-time', this.recordSeconds);
      return;
    }

    if (this.state === 'RECORDING') {
      if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
      if (recordTimerBox) recordTimerBox.style.opacity = '1';
      if (recordBtn) recordBtn.style.display = 'none';
      if (statusMsg) statusMsg.textContent = 'Recording... Please read aloud.';
      if (stopBtn) stopBtn.style.display = 'inline-flex';
      return;
    }

    if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
    if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
    if (recordBtn) {
      recordBtn.textContent = 'Next Prompt';
      recordBtn.disabled = false;
      recordBtn.style.display = '';
    }
    if (statusMsg) statusMsg.textContent = 'Processing...';
    if (resultBox) resultBox.style.display = 'block';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  startPrepTimer() {
    this.stopTimer();
    let timeLeft = this.prepSeconds;
    this.updateTimerDisplay('ra-prep-time', timeLeft);

    this.timerInterval = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft < 0) {
        this.stopTimer();
        this.startRecording();
      } else {
        this.updateTimerDisplay('ra-prep-time', timeLeft);
      }
    }, 1000);
  }

  async startRecording() {
    this.cleanup();
    this.state = 'RECORDING';
    this.updateUIForState();

    let timeLeft = this.recordSeconds;
    this.updateTimerDisplay('ra-record-time', timeLeft);

    this.timerInterval = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft < 0) {
        this.stopTimer();
        this.handleRecordClick();
      } else {
        this.updateTimerDisplay('ra-record-time', timeLeft);
      }
    }, 1000);

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      this.mediaRecorder = new window.MediaRecorder(this.audioStream);
      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) this.recordedChunks.push(event.data);
      });
      this.mediaRecorder.addEventListener('stop', async () => {
        const rawBlob = new Blob(this.recordedChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        await this.submitToAzure(rawBlob);
      });
      this.mediaRecorder.start();
    } catch (error) {
      console.error('Microphone access failed:', error);
      this.applyUnsupportedState();
    }
  }""",
    code, flags=re.DOTALL
)

# Replace handleRecordClick through calculateWER
code = re.sub(
    r"  handleRecordClick\(\) \{.*?    return Math\.max\(0, Math\.min\(100, Math\.round\(\(1 - wer\) \* 100\)\)\);\n  }",
    """  handleRecordClick() {
    if (this.state === 'PREP') {
      if (!this.isSupported()) {
        this.applyUnsupportedState();
        return;
      }
      this.startRecording();
      return;
    }

    if (this.state === 'RECORDING') {
      this.stopTimer();
      this.state = 'RESULTS';
      this.updateUIForState();
      
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
      this.stopMediaStream();
      return;
    }

    if (this.state === 'RESULTS') {
      this.loadNextPrompt();
    }
  }

  stopRecordingManually() {
    if (this.state !== 'RECORDING') return;
    this.stopTimer();
    this.state = 'RESULTS';
    this.updateUIForState();

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.stopMediaStream();

    const audioEl = document.getElementById('ra-elevenlabs-audio');
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    const playBtn = document.getElementById('ra-play-audio-btn');
    if (playBtn) playBtn.textContent = 'Play';
  }

  async submitToAzure(rawBlob) {
    const statusMsg = document.getElementById('ra-status-message');
    try {
      if (statusMsg) statusMsg.textContent = 'Formatting audio...';
      const wavBlob = await this.prepareWavBlob(rawBlob);

      if (statusMsg) statusMsg.textContent = 'Analyzing pronunciation...';
      const formData = new FormData();
      formData.append('audio', wavBlob, 'recording.wav');
      formData.append('referenceText', this.currentText);

      const response = await fetch('/api/read-aloud/assess', {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'Assessment failed.');
      }

      this.processAzureResults(payload);
    } catch (err) {
      console.error('Azure assessment error:', err);
      if (statusMsg) statusMsg.textContent = 'Assessment failed. Please try again.';
      const accuracyElement = document.getElementById('ra-accuracy-value');
      if (accuracyElement) accuracyElement.textContent = '0';
    }
  }

  async prepareWavBlob(blob) {
    if (blob.type === 'audio/wav' || blob.type === 'audio/wave') return blob;
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    if (typeof audioContext.close === 'function') await audioContext.close().catch(() => {});
    return this.audioBufferToWav(rendered);
  }

  audioBufferToWav(buffer) {
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length;
    const wavBuffer = new ArrayBuffer(44 + dataLength * 2);
    const view = new DataView(wavBuffer);
    const writeString = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength * 2, true);
    let offset = 44;
    for (let i = 0; i < dataLength; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
    }
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  processAzureResults(payload) {
    const statusMsg = document.getElementById('ra-status-message');
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');

    if (statusMsg) statusMsg.textContent = 'Analysis complete.';
    if (accuracyElement) accuracyElement.textContent = payload.accuracyScore.toString();

    if (feedbackElement) {
      if (!payload.words || payload.words.length === 0) {
        feedbackElement.innerHTML = `You said: <i>"${payload.recognizedText || 'Nothing detected'}"</i>`;
      } else {
        let html = '<p style="line-height: 1.6; font-size: 1.1rem; padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;">';
        payload.words.forEach(w => {
           let color = 'inherit';
           if (w.errorType === 'Omission') {
               color = '#9ca3af'; // gray out omitted
               html += `<span style="color: ${color}; text-decoration: line-through; margin-right: 4px;" title="Omitted">${w.word}</span>`;
           } else if (w.errorType === 'Insertion') {
               color = '#f59e0b'; // orange for extra words
               html += `<span style="color: ${color}; font-style: italic; margin-right: 4px;" title="Inserted (Extra) word">[${w.word}]</span>`;
           } else if (w.accuracyScore < 60) {
               color = '#ef4444'; // red
               html += `<span style="color: ${color}; font-weight: 500; margin-right: 4px;" title="Accuracy: ${w.accuracyScore}">${w.word}</span>`;
           } else if (w.accuracyScore < 80) {
               color = '#f59e0b'; // orange
               html += `<span style="color: ${color}; margin-right: 4px;" title="Accuracy: ${w.accuracyScore}">${w.word}</span>`;
           } else {
               color = '#10b981'; // green
               html += `<span style="color: ${color}; margin-right: 4px;" title="Accuracy: ${w.accuracyScore}">${w.word}</span>`;
           }
        });
        html += '</p>';
        html += `<p style="margin-top: 10px; font-size: 0.95em; color: #4b5563;"><strong>Fluency:</strong> ${payload.fluencyScore}% &nbsp;|&nbsp; <strong>Completeness:</strong> ${payload.completenessScore}%</p>`;
        feedbackElement.innerHTML = html;
      }
    }
  }""",
    code, flags=re.DOTALL
)

with open(r'c:\Cursor AI\public\read-aloud-mode.js', 'w', encoding='utf-8') as f:
    f.write(code)
