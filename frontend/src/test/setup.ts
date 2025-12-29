import '@testing-library/jest-dom';

// Mock window.matchMedia for components using media queries
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock AudioContext for audio tests
class MockAudioContext {
  createGain() {
    return {
      connect: () => {},
      gain: { value: 1, setValueAtTime: () => {} },
    };
  }
  createOscillator() {
    return {
      connect: () => {},
      start: () => {},
      stop: () => {},
      frequency: { value: 440 },
    };
  }
  createAnalyser() {
    return {
      connect: () => {},
      fftSize: 2048,
      getByteFrequencyData: () => {},
    };
  }
  get currentTime() {
    return 0;
  }
  get destination() {
    return {};
  }
}

(globalThis as any).AudioContext = MockAudioContext;
(globalThis as any).webkitAudioContext = MockAudioContext;
