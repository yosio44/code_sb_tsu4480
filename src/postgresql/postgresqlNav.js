const links = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
const sections = links
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

function setActive(id) {
  for (const link of links) {
    link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
  }
}

if ('IntersectionObserver' in window && sections.length) {
  const observed = new Map();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        observed.set(entry.target.id, entry.isIntersecting && entry.intersectionRatio > 0);
      }
      const visible = sections.find((section) => observed.get(section.id));
      if (visible) setActive(visible.id);
    },
    { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.15, 1] }
  );
  for (const section of sections) observer.observe(section);
}
