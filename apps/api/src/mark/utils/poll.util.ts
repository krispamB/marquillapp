export interface LinkedInPoll {
  question: string;
  options: string[];
}

export interface PollValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateLinkedInPoll(poll: LinkedInPoll): PollValidationResult {
  const errors: string[] = [];

  if (!poll.question?.trim()) {
    errors.push('Poll question is required.');
  } else if (poll.question.length > 140) {
    errors.push(`Question exceeds 140 characters (${poll.question.length}).`);
  }

  if (!poll.options || poll.options.length < 2) {
    errors.push('Poll must have at least 2 options.');
  } else if (poll.options.length > 4) {
    errors.push('Poll cannot have more than 4 options.');
  } else {
    poll.options.forEach((opt, i) => {
      if (!opt?.trim()) {
        errors.push(`Option ${i + 1} is empty.`);
      } else if (opt.length > 30) {
        errors.push(`Option ${i + 1} exceeds 30 characters (${opt.length}).`);
      }
    });

    const unique = new Set(poll.options.map((o) => o.trim().toLowerCase()));
    if (unique.size !== poll.options.length) {
      errors.push('Poll options must be unique.');
    }
  }

  return { valid: errors.length === 0, errors };
}
