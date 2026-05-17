import "./NetworkLoader.css";

interface NetworkLoaderProps {
    network: string;
}

const DOT_COUNT = 6;
const ORBIT_RADIUS = 26;

export default function NetworkLoader({ network }: NetworkLoaderProps) {
    return (
        <div className="network-loader" role="status" aria-live="polite">
            <div className="network-loader-orbit" aria-hidden="true">
                <div className="network-loader-orbit-glow" />
                {Array.from({ length: DOT_COUNT }).map((_, i) => {
                    const angle = (360 / DOT_COUNT) * i;
                    return (
                        <span
                            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative array
                            key={i}
                            className="network-loader-dot-slot"
                            style={{
                                transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-${ORBIT_RADIUS}px)`,
                            }}
                        >
                            <span
                                className="network-loader-dot"
                                style={{ animationDelay: `${i * 0.16}s` }}
                            />
                        </span>
                    );
                })}
            </div>
            <p className="network-loader-text">
                Connecting to <span className="network-loader-network">{network}</span>
            </p>
        </div>
    );
}
