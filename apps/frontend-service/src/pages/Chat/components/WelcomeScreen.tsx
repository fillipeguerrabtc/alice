import { motion } from 'framer-motion';

interface WelcomeScreenProps {
  headline: string;
}

export function WelcomeScreen({ headline }: WelcomeScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="flex w-full flex-col items-center justify-center px-2 text-center"
    >
      <h2 className="max-w-2xl text-balance text-[1.9rem] font-semibold tracking-[-0.04em] text-foreground md:text-5xl">
        {headline}
      </h2>
    </motion.div>
  );
}
