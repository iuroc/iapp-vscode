package android.view;

/**
 * Defines the responsibilities for a class that will be a parent of a View.
 */
public interface ViewParent {
    /**
     * Called when something has changed which has invalidated the layout of a child.
     */
    void requestLayout();
}
