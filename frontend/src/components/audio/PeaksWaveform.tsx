import React, { useEffect, useRef } from 'react';
import Peaks, { PeaksInstance, PeaksOptions } from 'peaks.js';

interface PeaksRegion {
    id: string;
    start: number;
    end: number;
    color?: string;
    drag?: boolean;
    resize?: boolean;
}

interface PeaksTheme {
    waveformColor?: string;
    playedWaveformColor?: string;
    playheadColor?: string;
    overviewWaveformColor?: string;
    overviewPlayedWaveformColor?: string;
    overviewHighlightColor?: string;
}

interface PeaksWaveformProps {
    audioUrl: string;
    peaksUrl?: string;
    height?: number;
    zoomviewHeight?: number;
    overviewHeight?: number;
    isPlaying?: boolean;
    isLooping?: boolean;
    muted?: boolean;
    regions?: PeaksRegion[];
    theme?: PeaksTheme;
    onReady?: (peaks: PeaksInstance) => void;
    onRegionChange?: (id: string, start: number, end: number) => void;
}

export const PeaksWaveform: React.FC<PeaksWaveformProps> = ({
    audioUrl,
    peaksUrl,
    height = 128,
    zoomviewHeight = 128,
    overviewHeight = 64,
    isPlaying,
    isLooping,
    muted,
    regions = [],
    theme = {},
    onReady,
    onRegionChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const zoomviewRef = useRef<HTMLDivElement>(null);
    const overviewRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const peaksInstance = useRef<PeaksInstance | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        return () => {
            if (audioContextRef.current) {
                try {
                    audioContextRef.current.close();
                } catch {
                    // ignore
                }
                audioContextRef.current = null;
            }
        };
    }, []);

    // Initialize Peaks
    useEffect(() => {
        if (!zoomviewRef.current || !overviewRef.current || !audioRef.current) return;

        const usePeaksData = !!peaksUrl;
        const audioContext = usePeaksData
            ? null
            : (audioContextRef.current ?? new AudioContext());
        if (!usePeaksData && audioContextRef.current === null) {
            audioContextRef.current = audioContext;
        }

        const options: PeaksOptions = {
            zoomview: {
                container: zoomviewRef.current,
                waveformColor: theme.waveformColor || '#06b6d4',
                playedWaveformColor: theme.playedWaveformColor || '#0891b2',
                playheadColor: theme.playheadColor || '#ffffff',
                showPlayheadTime: true,
            },
            overview: {
                container: overviewRef.current,
                waveformColor: theme.overviewWaveformColor || '#334155',
                playedWaveformColor: theme.overviewPlayedWaveformColor || '#475569',
                highlightColor: theme.overviewHighlightColor || 'rgba(255, 255, 255, 0.1)',
            },
            mediaElement: audioRef.current,
            webAudio: usePeaksData ? undefined : {
                audioContext: audioContext as AudioContext,
            },
            height: height,
            dataUri: usePeaksData ? {
                arraybuffer: peaksUrl as string
            } : undefined,
            zoomLevels: [512, 1024, 2048, 4096],
            segments: regions.map(r => ({
                startTime: r.start,
                endTime: r.end,
                editable: true,
                color: r.color || 'rgba(0, 225, 128, 0.3)',
                id: r.id,
                labelText: 'Loop'
            }))
        } as PeaksOptions;

        Peaks.init(options, (err, peaks) => {
            if (err) {
                console.error('Failed to initialize Peaks.js:', err);
                return;
            }
            peaksInstance.current = peaks || null;

            if (peaks) {
                // Handle Region Dragging
                peaks.on('segments.dragend', (event: any) => {
                    const segment = event.segment;
                    if (onRegionChange && segment && segment.id) {
                        onRegionChange(segment.id, segment.startTime, segment.endTime);
                    }
                });

                if (onReady) {
                    onReady(peaks);
                }
            }
        });

        return () => {
            if (peaksInstance.current) {
                peaksInstance.current.destroy();
                peaksInstance.current = null;
            }
        };
    }, [audioUrl, peaksUrl]); // Re-init if audio/peaks change

    // Handle Resize
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(() => {
            if (peaksInstance.current) {
                const zoomview = peaksInstance.current.views.getView('zoomview');
                const overview = peaksInstance.current.views.getView('overview');
                if (zoomview) zoomview.fitToContainer();
                if (overview) overview.fitToContainer();
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // Handle Mouse Wheel Zoom
    useEffect(() => {
        const zoomviewElement = zoomviewRef.current;
        if (!zoomviewElement) return;

        const handleWheel = (e: WheelEvent) => {
            if (!peaksInstance.current) return;

            e.preventDefault();

            const zoomview = peaksInstance.current.views.getView('zoomview');
            if (!zoomview) return;

            const currentZoom = peaksInstance.current.zoom.getZoom();
            const zoomLevels = [512, 1024, 2048, 4096, 8192, 16384];

            // Find current zoom index
            let currentIndex = zoomLevels.indexOf(currentZoom);
            if (currentIndex === -1) {
                // Find closest zoom level
                currentIndex = zoomLevels.reduce((prev, curr, idx) =>
                    Math.abs(curr - currentZoom) < Math.abs(zoomLevels[prev] - currentZoom) ? idx : prev
                    , 0);
            }

            // Zoom in (scroll down) or out (scroll up)
            const direction = e.deltaY > 0 ? 1 : -1;
            const newIndex = Math.max(0, Math.min(zoomLevels.length - 1, currentIndex + direction));

            if (newIndex !== currentIndex) {
                peaksInstance.current.zoom.setZoom(zoomLevels[newIndex]);
            }
        };

        zoomviewElement.addEventListener('wheel', handleWheel, { passive: false });
        return () => zoomviewElement.removeEventListener('wheel', handleWheel);
    }, []);

    // Sync Regions (if props change)
    useEffect(() => {
        if (!peaksInstance.current) return;
        peaksInstance.current.segments.removeAll();
        regions.forEach(r => {
            peaksInstance.current?.segments.add({
                startTime: r.start,
                endTime: r.end,
                editable: true,
                color: r.color || 'rgba(0, 225, 128, 0.3)',
                id: r.id,
                labelText: 'Loop'
            });
        });
    }, [regions]);

    // Sync Playback State
    useEffect(() => {
        if (!peaksInstance.current) return;
        if (isPlaying) {
            peaksInstance.current.player.play();
        } else {
            peaksInstance.current.player.pause();
        }
    }, [isPlaying]);

    // Sync Looping
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.loop = !!isLooping;
        }
    }, [isLooping]);

    // Sync Muted
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.muted = !!muted;
        }
    }, [muted]);

    return (
        <div ref={containerRef} className="flex flex-col gap-2 w-full bg-[#0f172a] p-2 rounded border border-[#1e293b]">
            <div
                ref={overviewRef}
                style={{ height: overviewHeight, width: '100%' }}
                className="rounded overflow-hidden"
            />
            <div
                ref={zoomviewRef}
                style={{ height: zoomviewHeight, width: '100%' }}
                className="rounded overflow-hidden border border-[#334155]"
            />
            <audio ref={audioRef} src={audioUrl} style={{ display: 'none' }} />
        </div>
    );
};
