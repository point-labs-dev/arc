export interface Option {
  readonly key: string
  readonly label: string
}

export type QuestionType = "YES_NO" | "MULTIPLE_CHOICE" | "FREEFORM" | "CONFIRMATION"

export interface Question {
  readonly text: string
  readonly type: QuestionType
  readonly options?: Option[]
  readonly default?: Answer
  readonly timeout_seconds?: number
  readonly stage: string
  readonly metadata?: Record<string, unknown>
}

export type AnswerValue = "YES" | "NO" | "SKIPPED" | "TIMEOUT" | string

export interface Answer {
  readonly value: AnswerValue
  readonly selected_option?: Option
  readonly text?: string
}

export interface Interviewer {
  ask(question: Question): Promise<Answer> | Answer
  askMultiple?(questions: Question[]): Promise<Answer[]> | Answer[]
  inform?(message: string, stage: string): Promise<void> | void
}

export class AutoApproveInterviewer implements Interviewer {
  ask(question: Question): Answer {
    if (question.type === "YES_NO" || question.type === "CONFIRMATION") {
      return { value: "YES" }
    }

    if (
      question.type === "MULTIPLE_CHOICE" &&
      question.options !== undefined &&
      question.options.length > 0
    ) {
      return {
        value: question.options[0].key,
        selected_option: question.options[0],
      }
    }

    return {
      value: "auto-approved",
      text: "auto-approved",
    }
  }
}

export class QueueInterviewer implements Interviewer {
  private readonly queue: Answer[]

  constructor(answers: Answer[] = []) {
    this.queue = [...answers]
  }

  enqueue(answer: Answer): void {
    this.queue.push(answer)
  }

  ask(): Answer {
    const answer = this.queue.shift()
    if (answer === undefined) {
      return {
        value: "SKIPPED",
      }
    }

    return answer
  }
}

export class CallbackInterviewer implements Interviewer {
  constructor(private readonly callback: (question: Question) => Promise<Answer> | Answer) {}

  ask(question: Question): Promise<Answer> | Answer {
    return this.callback(question)
  }
}
