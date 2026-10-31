package android.widget;

import android.content.Context;
import android.view.View;

/**
 * A user interface element that displays text to the user.
 */
public class TextView extends View {
    private CharSequence mText;

    public TextView(Context context) {
        mText = "";
    }

    /**
     * Returns the text displayed by the view.
     */
    public CharSequence getText() {
        return mText;
    }

    /**
     * Sets the text to display.
     */
    public final void setText(CharSequence text) {
        mText = text;
    }

    /**
     * Sets the text from a resource identifier.
     */
    public final void setText(int resid) {
    }
}
