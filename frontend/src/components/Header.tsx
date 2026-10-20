import { Link, NavLink, useLocation } from "react-router-dom";
import "./Header.css";

export function Header() {
  // "Matches" covers the picker and every match page; "Compare" is its own page
  const onCompare = useLocation().pathname.startsWith("/compare");
  return (
    <header>
      <nav className="nav page-width site-nav" aria-label="Main">
        <Link to="/" className="nav-brand site-nav__brand">
          <span className="site-nav__logo" aria-hidden="true" />
          <span>PlayIQ</span>
        </Link>
        <div className="site-nav__links">
          <NavLink to="/" className={`site-nav__link${onCompare ? "" : " is-active"}`} aria-current={onCompare ? undefined : "page"}>
            Matches
          </NavLink>
          <NavLink to="/compare" className={`site-nav__link${onCompare ? " is-active" : ""}`}>
            Compare
          </NavLink>
        </div>
      </nav>
    </header>
  );
}

export default Header;
