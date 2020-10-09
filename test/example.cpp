#include <emscripten.h>
#include <leon/constants.h>

extern "C"
{
	/* Declare Javascript function for use in C/C++ */
	// extern int sub(int a, int b);

	EMSCRIPTEN_KEEPALIVE /* <= Needed to export this function to javascript "module.exports" */
	int add(int a, int b)
	{
		return a + b;
	}

}