import * as React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { cn } from "~/lib/utils";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

interface TabsProps extends React.ComponentPropsWithoutRef<typeof View> {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

const Tabs = React.forwardRef<View, TabsProps>(
  ({ value, onValueChange, children, className, ...props }, ref) => {
    return (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <View ref={ref} className={cn("w-full", className)} {...props}>
          {children}
        </View>
      </TabsContext.Provider>
    );
  }
);
Tabs.displayName = "Tabs";

const TabsList = React.forwardRef<
  View,
  React.ComponentPropsWithoutRef<typeof View>
>(({ className, children, ...props }, ref) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View
        ref={ref}
        className={cn(
          "flex-row items-center rounded-lg bg-muted p-1",
          className
        )}
        {...props}
      >
        {children}
      </View>
    </ScrollView>
  );
});
TabsList.displayName = "TabsList";

interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof Pressable> {
  value: string;
  children: React.ReactNode;
}

const TabsTrigger = React.forwardRef<View, TabsTriggerProps>(
  ({ value, children, className, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error("TabsTrigger must be used within Tabs");

    const isActive = context.value === value;

    return (
      <Pressable
        ref={ref}
        className={cn(
          "flex-1 items-center justify-center rounded-md px-3 py-1.5",
          isActive && "bg-primary",
          className
        )}
        onPress={() => context.onValueChange(value)}
        {...props}
      >
        <Text
          className={cn(
            "text-sm font-medium",
            isActive ? "text-primary-foreground" : "text-muted-foreground"
          )}
        >
          {children}
        </Text>
      </Pressable>
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

interface TabsContentProps
  extends React.ComponentPropsWithoutRef<typeof View> {
  value: string;
  children: React.ReactNode;
}

const TabsContent = React.forwardRef<View, TabsContentProps>(
  ({ value, children, className, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error("TabsContent must be used within Tabs");

    if (context.value !== value) return null;

    return (
      <View ref={ref} className={cn("mt-2", className)} {...props}>
        {children}
      </View>
    );
  }
);
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
