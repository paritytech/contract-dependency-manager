import { Link } from "react-router-dom";
import NetworkConfig from "./NetworkConfig";
import { handleExternalClick } from "../lib/external-link";
import "./Header.css";

const REPO_URL = "https://github.com/paritytech/contract-dependency-manager";

const EXTERNAL_LINKS: { label: string; href: string }[] = [
    { label: "Docs", href: REPO_URL },
    { label: "Github", href: REPO_URL },
    { label: "Playground", href: "https://playground.dot" },
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
                        onClick={handleExternalClick}
                        className="header-nav-link"
                    >
                        {link.label}
                    </a>
                ))}
                <NetworkConfig />
            </nav>
        </header>
    );
}
