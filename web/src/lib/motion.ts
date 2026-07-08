import type { Variants } from "framer-motion";

/** Shared easing — a gentle, slightly-overshooting curve for the paper feel. */
export const easeSoft: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** fadeUp — the signature entrance from the design's @keyframes fadeUp. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easeSoft } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4, ease: easeSoft } },
};

/** Staggered container — children fade up one after another. */
export const stagger = (staggerChildren = 0.06, delayChildren = 0.04): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren, delayChildren },
  },
});

/** A child item that fades up inside a stagger container. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: easeSoft } },
};

/** Lift on hover, press on tap — for raised paper cards / buttons. */
export const hoverLift = {
  whileHover: { y: -2, transition: { duration: 0.15, ease: easeSoft } },
  whileTap: { y: 0, scale: 0.99 },
};

export const tapDown = {
  whileTap: { y: 1, scale: 0.99 },
};