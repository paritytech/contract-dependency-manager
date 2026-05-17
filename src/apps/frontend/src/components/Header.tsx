import { Link } from "react-router-dom";
import NetworkConfig from "./NetworkConfig";
import "./Header.css";

const EXTERNAL_LINKS: { label: string; href: string }[] = [
    { label: "Docs", href: "https://github.com/paritytech/contract-dependency-manager#readme" },
    { label: "Github", href: "https://github.com/paritytech/contract-dependency-manager" },
    { label: "Playground", href: "https://playground.dot.li" },
];

export default function Header() {
    return (
        <header className="header">
            <nav className="header-nav" aria-label="Primary">
                <Link to="/" className="header-nav-link">
                    Home
                </Link>
                {EXTERNAL_LINKS.map((link) => (
                    <a
                        key={link.label}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="header-nav-link"
                    >
                        {link.label}
                    </a>
                ))}
            </nav>
            <NetworkConfig />
        </header>
    );
}
