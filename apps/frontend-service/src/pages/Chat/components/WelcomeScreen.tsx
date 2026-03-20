import { motion } from 'framer-motion';

interface WelcomeScreenProps {
  headline: string | null;
}

export function WelcomeScreen({ headline }: WelcomeScreenProps) {
  return (
    <div className="flex min-h-[5.25rem] w-full flex-col items-center justify-center px-2 text-center md:min-h-[7rem]">
      {headline ? (
        <motion.h2
          key={headline}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="max-w-[18ch] overflow-hidden text-balance text-[1.9rem] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground md:max-w-[22ch] md:text-5xl"
          style={{
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            display: '-webkit-box',
          }}
        >
          {headline}
        </motion.h2>
      ) : (
        <div aria-hidden="true" className="h-[4.25rem] w-full md:h-[5.5rem]" />
      )}
    </div>
  );
}
