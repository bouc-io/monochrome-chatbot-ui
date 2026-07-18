import { Sparkles, Pencil, BookOpen, Code, Lightbulb, HelpCircle } from "lucide-react";
import { useAuth } from "@/auth/authcontext";

interface WelcomeScreenProps {
  onSuggestionClick: (prompt: string) => void;
}

const SUGGESTED_PROMPTS = [
  { icon: Pencil, label: "Write", prompt: "Help me write a professional email" },
  { icon: BookOpen, label: "Learn", prompt: "Explain a complex topic in simple terms" },
  { icon: Code, label: "Code", prompt: "Help me debug or write some code" },
  { icon: Lightbulb, label: "Brainstorm", prompt: "Help me brainstorm ideas for a project" },
  { icon: HelpCircle, label: "Analyze", prompt: "Analyze and summarize this information" },
  { icon: Sparkles, label: "Create", prompt: "Help me create something new and creative" },
];

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

export const WelcomeScreen = ({ onSuggestionClick }: WelcomeScreenProps) => {
  const { user } = useAuth();
  const displayName = (user?.name || user?.preferred_username || user?.email || "") as string;
  const firstName = displayName.split(/[\s@]/)[0];
  const greeting = getGreeting();

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl text-center">
        {/* Greeting */}
        <div className="mb-10">
          <h2 className="text-3xl font-semibold text-foreground">
            <Sparkles className="inline-block w-7 h-7 mr-2 text-primary" />
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h2>
        </div>

        {/* Suggestion chips */}
        <div className="flex flex-wrap justify-center gap-3">
          {SUGGESTED_PROMPTS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              onClick={() => onSuggestionClick(prompt)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-background text-sm font-medium text-foreground hover:bg-accent hover:border-accent-foreground/20 transition-colors"
            >
              <Icon className="w-4 h-4 text-muted-foreground" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
