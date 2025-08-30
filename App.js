import React from "react";
import { Routes, Route, Link } from "react-router-dom";

function Home() {
  return <h2>Home - Digital Ticketing App</h2>;
}

function App() {
  return (
    <div>
      <nav>
        <Link to="/">Home</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </div>
  );
}

export default App;
