import { motion } from 'framer-motion';

function Skeleton({ className = '', width, height, rounded = 'rounded' }) {
  return (
    <motion.div
      animate={{
        opacity: [0.5, 1, 0.5],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeInOut'
      }}
      className={`bg-slate-200 ${rounded} ${className}`}
      style={{ width, height }}
    />
  );
}

export default Skeleton;

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 p-4">
      <div className="flex items-start gap-3 mb-3">
        <Skeleton width={40} height={40} rounded="rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton width="60%" height={20} />
          <Skeleton width="40%" height={16} />
        </div>
      </div>
      <Skeleton width="100%" height={60} rounded="rounded-lg" />
    </div>
  );
}

export function SkeletonList({ count = 3 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
