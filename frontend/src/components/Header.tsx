import { Link } from "react-router-dom";
import "./Header.css";

export function Header() {
  return (
    <header>
      <nav className="nav page-width site-nav">
        <Link to="/" className="nav-brand site-nav__brand">
          <span className="site-nav__logo" aria-hidden="true" />
          <span>PlayIQ</span>
        </Link>
        <span className="site-nav__source">StatsBomb Open Data</span>
      </nav>
    </header>
  );
}

export default Header;
