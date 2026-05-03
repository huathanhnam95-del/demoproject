from vsdx import VisioFile
from vsdx import Shape

# Create an empty Visio file
out = VisioFile()
page = out.pages[0]

# Add a rectangle
def draw_box(x, y, text, width=1.5, height=0.5):
    # Wait, how to create a shape in vsdx package?
    # Usually: shape = Shape() is not supported, we have to copy an existing shape or add one from stencil.
    # vsdx doesn't easily create primitive shapes out of thin air if there are no master shapes.
    pass

print(dir(out))
print(dir(page))
