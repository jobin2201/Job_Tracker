const reveals = document.querySelectorAll(".reveal");
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
      }
    });
  },
  { threshold: 0.16 }
);

reveals.forEach((element) => revealObserver.observe(element));

const sectionLinks = document.querySelectorAll("[data-section-link]");
const navLinks = document.querySelectorAll(".nav-links a");
const mobileNavLinks = document.querySelectorAll(".mobile-nav-panel a");
const observedSections = document.querySelectorAll(".observed-section");
const header = document.querySelector(".site-header");
const mobileMenuToggle = document.querySelector(".mobile-menu-toggle");
const mobileNavPanel = document.querySelector(".mobile-nav-panel");
let lastScrollY = window.scrollY;
let tickingHeader = false;
let keepHeaderVisibleUntilScroll = false;
let navigationLockStartedAt = 0;

const activeObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const section = entry.target.dataset.section;
      sectionLinks.forEach((link) => {
        link.classList.toggle("active", link.dataset.sectionLink === section);
      });

      navLinks.forEach((link) => {
        const target = link.getAttribute("href")?.replace("#", "");
        link.classList.toggle("active", target === entry.target.id);
      });

      mobileNavLinks.forEach((link) => {
        const target = link.getAttribute("href")?.replace("#", "");
        link.classList.toggle("active", target === entry.target.id);
      });
    });
  },
  { threshold: 0.42 }
);

observedSections.forEach((section) => activeObserver.observe(section));

document.querySelectorAll(".parallax-zone").forEach((zone) => {
  let parallaxFrame = 0;

  zone.addEventListener("pointermove", (event) => {
    if (window.matchMedia("(max-width: 760px), (pointer: coarse)").matches) return;
    if (parallaxFrame) return;

    parallaxFrame = requestAnimationFrame(() => {
      parallaxFrame = 0;
      const rect = zone.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;

      zone.style.setProperty("--smooth-x", `${x * 10}px`);
      zone.style.setProperty("--smooth-y", `${y * 10}px`);
    });
  });

  zone.addEventListener("pointerleave", () => {
    zone.style.setProperty("--smooth-x", "0px");
    zone.style.setProperty("--smooth-y", "0px");
  });
});

sectionLinks.forEach((link) => {
  link.addEventListener("click", () => {
    sectionLinks.forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

function closeMobileNav() {
  mobileMenuToggle?.classList.remove("is-open");
  mobileNavPanel?.classList.remove("is-open");
  mobileMenuToggle?.setAttribute("aria-expanded", "false");
}

mobileMenuToggle?.addEventListener("click", () => {
  const isOpen = mobileMenuToggle.classList.toggle("is-open");
  mobileNavPanel?.classList.toggle("is-open", isOpen);
  mobileMenuToggle.setAttribute("aria-expanded", String(isOpen));
});

mobileNavLinks.forEach((link) => {
  link.addEventListener("click", () => {
    keepHeaderVisibleUntilScroll = true;
    navigationLockStartedAt = Date.now();
    header?.classList.remove("header-hidden");
    closeMobileNav();
  });
});

function releaseHeaderLockFromUserGesture() {
  if (!keepHeaderVisibleUntilScroll) return;
  if (Date.now() - navigationLockStartedAt < 450) return;

  keepHeaderVisibleUntilScroll = false;
}

window.addEventListener("wheel", releaseHeaderLockFromUserGesture, { passive: true });
window.addEventListener("touchmove", releaseHeaderLockFromUserGesture, { passive: true });
window.addEventListener("keydown", (event) => {
  const scrollKeys = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "];
  if (scrollKeys.includes(event.key)) {
    releaseHeaderLockFromUserGesture();
  }
});

function updateHeaderVisibility() {
  tickingHeader = false;
  const currentY = window.scrollY;
  const scrollingDown = currentY > lastScrollY;
  const scrollingUp = currentY < lastScrollY;
  const farEnough = currentY > 120;

  if (keepHeaderVisibleUntilScroll) {
    header?.classList.remove("header-hidden");
  } else if (scrollingDown && farEnough) {
    header?.classList.add("header-hidden");
  } else if (scrollingUp || !farEnough) {
    header?.classList.remove("header-hidden");
  }

  if (scrollingDown && farEnough) {
    closeMobileNav();
  }
  lastScrollY = Math.max(currentY, 0);
}

window.addEventListener(
  "scroll",
  () => {
    if (tickingHeader) return;
    tickingHeader = true;
    requestAnimationFrame(updateHeaderVisibility);
  },
  { passive: true }
);
