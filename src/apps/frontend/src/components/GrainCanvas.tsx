import { useEffect, useRef } from "react";

export default function GrainCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        if (!parent) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let width = 0;
        let height = 0;
        let rafId: number | null = null;
        let startTs: number | null = null;
        let seeded = false;
        let smoothX = 0;
        let smoothY = 0;

        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const baseEase = 0.03;
        const minEase = 0.007;
        const rampDurationMs = 2200;

        function resizeCanvas() {
            const rect = parent!.getBoundingClientRect();
            width = canvas!.width = Math.max(1, Math.floor(rect.width));
            height = canvas!.height = Math.max(1, Math.floor(rect.height));
        }

        function generateGrain() {
            const imgData = ctx!.createImageData(width, height);
            const alpha = 28;
            for (let i = 0; i < imgData.data.length; i += 4) {
                const v = Math.random() * 255;
                imgData.data[i] = v;
                imgData.data[i + 1] = v;
                imgData.data[i + 2] = v;
                imgData.data[i + 3] = alpha;
            }
            return imgData;
        }

        resizeCanvas();
        let grain = generateGrain();

        function draw(t: number) {
            if (prefersReducedMotion.matches) {
                ctx!.clearRect(0, 0, width, height);
                ctx!.putImageData(grain, 0, 0);
                const x = width * 0.5;
                const y = height * 0.35;
                const gradient = ctx!.createRadialGradient(x, y, 0, x, y, 600);
                gradient.addColorStop(0, "rgba(255,255,255,0.12)");
                gradient.addColorStop(1, "rgba(255,255,255,0)");
                ctx!.fillStyle = gradient;
                ctx!.fillRect(0, 0, width, height);
                return;
            }

            if (startTs === null) startTs = t;

            if (!seeded) {
                const time0 = t * 0.00025;
                smoothX = width * (0.5 + 0.28 * Math.cos(time0));
                smoothY = height * (0.42 + 0.2 * Math.sin(time0 * 1.15));
                seeded = true;
            }

            if (!(draw as any).lastGrainTs || t - (draw as any).lastGrainTs > 120) {
                grain = generateGrain();
                (draw as any).lastGrainTs = t;
            }

            ctx!.clearRect(0, 0, width, height);
            ctx!.putImageData(grain, 0, 0);

            const time = t * 0.00025;
            const targetX = width * (0.5 + 0.28 * Math.cos(time));
            const targetY = height * (0.42 + 0.2 * Math.sin(time * 1.15));

            const elapsed = t - startTs!;
            const ramp = Math.min(1, elapsed / rampDurationMs);
            const ease = minEase + (baseEase - minEase) * ramp;
            smoothX += (targetX - smoothX) * ease;
            smoothY += (targetY - smoothY) * ease;

            const gradient = ctx!.createRadialGradient(smoothX, smoothY, 0, smoothX, smoothY, 900);
            gradient.addColorStop(0, "rgba(255,255,255,0.18)");
            gradient.addColorStop(0.35, "rgba(255,255,255,0.08)");
            gradient.addColorStop(1, "rgba(255,255,255,0)");

            ctx!.fillStyle = gradient;
            ctx!.fillRect(0, 0, width, height);

            rafId = requestAnimationFrame(draw);
        }

        function start() {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(draw);
        }

        const ro = new ResizeObserver(() => {
            resizeCanvas();
            grain = generateGrain();
            smoothX = width * 0.5;
            smoothY = height * 0.38;
            startTs = null;
            seeded = false;
            start();
        });
        ro.observe(parent);

        start();

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: 0,
                filter: "brightness(1)",
            }}
        />
    );
}
